/*
 * Flow Kit Deploy Worker — Bundled
 * Single-file deployment for Cloudflare Workers
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/deploy') {
      return handleDeploy(request, env, ctx);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/status/')) {
      const jobId = url.pathname.split('/').pop();
      return handleStatus(jobId, env);
    }
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  },
};

async function handleDeploy(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ message: 'Invalid JSON body' }, 400); }

  const { provider, credentials } = body;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  // Rate limiting
  const rl = await checkRateLimit(env, ip);
  if (!rl.allowed) return jsonResponse({ message: `Rate limit exceeded. Try again in ${rl.retryAfter}s.` }, 429);

  // Validate
  let errors;
  if (provider === 'oracle') errors = validateOracleCredentials(credentials);
  else if (provider === 'aws') errors = validateAWSCredentials(credentials);
  else if (provider === 'existing') errors = validateExistingCredentials(credentials);
  else return jsonResponse({ message: `Unknown provider: ${provider}` }, 400);

  if (errors?.length > 0) return jsonResponse({ message: errors.join('. ') }, 400);

  // SSE stream
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = async (data) => { try { await writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {} };

  ctx.waitUntil((async () => {
    try {
      let result;
      if (provider === 'oracle') {
        send({ type: 'log', message: 'Starting Oracle Cloud deployment...', level: 'step' });
        result = await createOracleInstance(credentials, (msg, lvl) => send({ type: 'log', message: sanitizeLog(msg), level: lvl || 'info' }));
      } else if (provider === 'aws') {
        send({ type: 'log', message: 'Starting AWS deployment...', level: 'step' });
        result = await createAWSInstance(credentials, (msg, lvl) => send({ type: 'log', message: sanitizeLog(msg), level: lvl || 'info' }));
      } else if (provider === 'existing') {
        send({ type: 'log', message: 'Generating install command...', level: 'step' });
        const cmd = generateInstallCommand(credentials.ip, credentials.user);
        send({ type: 'log', message: `Run this on your VPS:\n${cmd}`, level: 'warn' });
        send({ type: 'success', vpsIp: credentials.ip, authToken: 'Run the command above' });
        await writer.close(); return;
      }
      const authToken = generateToken();
      send({ type: 'success', vpsIp: result.publicIp, instanceId: result.instanceId, authToken });
    } catch (err) {
      send({ type: 'error', message: err.message });
    } finally { await writer.close(); }
  })());

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', ...CORS_HEADERS },
  });
}

async function handleStatus(jobId, env) {
  const job = await env.DEPLOY_JOBS?.get(`job:${jobId}`, { type: 'json' });
  if (!job) return jsonResponse({ message: 'Job not found' }, 404);
  return jsonResponse(job);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Validation ---

function validateOracleCredentials(c) {
  const e = [];
  if (!c.tenancy?.startsWith('ocid1.tenancy.')) e.push('Invalid Tenancy OCID');
  if (!c.user?.startsWith('ocid1.user.')) e.push('Invalid User OCID');
  if (!c.privateKey?.includes('BEGIN')) e.push('Invalid private key');
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){15}$/i.test(c.fingerprint)) e.push('Invalid fingerprint');
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(c.region)) e.push('Invalid region');
  if (!c.sshPublicKey?.startsWith('ssh-')) e.push('Invalid SSH public key');
  return e;
}

function validateAWSCredentials(c) {
  const e = [];
  if (!c.accessKeyId?.startsWith('AKIA')) e.push('Invalid Access Key ID');
  if (!c.secretAccessKey || c.secretAccessKey.length < 20) e.push('Invalid Secret Access Key');
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(c.region)) e.push('Invalid region');
  if (!c.sshPublicKey?.startsWith('ssh-')) e.push('Invalid SSH public key');
  return e;
}

function validateExistingCredentials(c) {
  const e = [];
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(c.ip)) e.push('Invalid IP');
  if (!c.user) e.push('Username required');
  if (!c.sshPrivateKey?.includes('BEGIN')) e.push('Invalid SSH private key');
  return e;
}

function sanitizeLog(msg) { return String(msg).replace(/[\r\n]+/g, ' ').substring(0, 500); }

async function checkRateLimit(env, ip) {
  if (!env.DEPLOY_JOBS) return { allowed: true };
  const key = `rate:${ip}`;
  const now = Date.now();
  const data = await env.DEPLOY_JOBS.get(key, { type: 'json' });
  if (!data || now > data.resetAt) {
    await env.DEPLOY_JOBS.put(key, JSON.stringify({ count: 1, resetAt: now + 3600000 }), { expirationTtl: 3600 });
    return { allowed: true };
  }
  if (data.count >= 5) return { allowed: false, retryAfter: Math.ceil((data.resetAt - now) / 1000) };
  data.count++;
  await env.DEPLOY_JOBS.put(key, JSON.stringify(data), { expirationTtl: 3600 });
  return { allowed: true };
}

// --- Oracle Cloud ---

const OCI_VERSION = '20160918';

async function createOracleInstance(creds, onLog) {
  const { tenancy, user, privateKey, fingerprint, region, shape, ocpus, sshPublicKey, compartment } = creds;
  const compId = compartment || tenancy;
  const baseUrl = `https://iaas.${region}.oraclecloud.com`;

  onLog('Authenticating with Oracle Cloud API...');
  const ad = (await ociFetch(creds, baseUrl, 'GET', `/20160918/availabilityDomains?compartmentId=${compId}`))[0].name;
  onLog(`Availability domain: ${ad}`);

  const imageId = await getOracleImage(creds, baseUrl, onLog);
  onLog(`Image: ${imageId}`);

  const net = await ensureOracleNetwork(creds, baseUrl, compId, onLog);

  const body = {
    displayName: 'flowkit-deploy',
    compartmentId: compId,
    shape,
    shapeConfig: shape.includes('Flex') ? { ocpus, memoryInGBs: ocpus * 6 } : undefined,
    sourceDetails: { sourceType: 'image', imageId },
    createVnicDetails: { subnetId: net.subnetId, assignPublicIp: true, displayName: 'flowkit-vnic' },
    metadata: { ssh_authorized_keys: sshPublicKey, user_data: btoa(generateOracleUserData()) },
  };

  onLog('Creating compute instance...');
  const inst = await ociFetch(creds, baseUrl, 'POST', '/20160918/instances', body);
  onLog(`Instance created: ${inst.id}`);

  onLog('Waiting for instance to start (2-3 min)...');
  const result = await waitForOracle(creds, baseUrl, inst.id, onLog);

  onLog(`Instance running at ${result.publicIp}`);
  onLog('Waiting for setup to complete (3-5 min)...');
  await waitForFlowKitReady(result.publicIp, onLog);

  return result;
}

async function getOracleImage(creds, baseUrl, onLog) {
  const res = await ociFetch(creds, baseUrl, 'GET', `/20160918/images?compartmentId=${creds.tenancy}&operatingSystem=Oracle Linux&operatingSystemVersion=8&shape=VM.Standard.A1.Flex&sortBy=timeCreated&sortOrder=DESC`);
  if (!res?.length) throw new Error('No Oracle Linux image found');
  return res[0].id;
}

async function ensureOracleNetwork(creds, baseUrl, compId, onLog) {
  onLog('Checking network...');
  const vcns = await ociFetch(creds, baseUrl, 'GET', `/20160918/vcns?compartmentId=${compId}`);
  let vcnId, subnetId;

  if (vcns?.length) {
    vcnId = vcns[0].id;
    const subs = await ociFetch(creds, baseUrl, 'GET', `/20160918/subnets?compartmentId=${compId}&vcnId=${vcnId}`);
    if (subs?.length) subnetId = subs[0].id;
  }

  if (!vcnId) {
    onLog('Creating VCN...');
    const vcn = await ociFetch(creds, baseUrl, 'POST', '/20160918/vcns', { compartmentId: compId, displayName: 'flowkit-vcn', cidrBlock: '10.0.0.0/16' });
    vcnId = vcn.id;
    const igw = await ociFetch(creds, baseUrl, 'POST', '/20160918/internetgateways', { compartmentId: compId, vcnId, displayName: 'flowkit-igw', isEnabled: true });
    const rt = await ociFetch(creds, baseUrl, 'POST', '/20160918/routetables', { compartmentId: compId, vcnId, displayName: 'flowkit-rt', routeRules: [{ destination: '0.0.0.0/0', destinationType: 'CIDR_BLOCK', networkEntityId: igw.id }] });
    const sl = await ociFetch(creds, baseUrl, 'POST', '/20160918/securitylists', { compartmentId: compId, vcnId, displayName: 'flowkit-sl', ingressSecurityRules: [
      { protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 22, max: 22 } } },
      { protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 3000, max: 3000 } } },
      { protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 8100, max: 8100 } } },
      { protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 9222, max: 9222 } } },
      { protocol: '1', source: '0.0.0.0/0' },
    ], egressSecurityRules: [{ protocol: 'all', destination: '0.0.0.0/0' }] });
    const sub = await ociFetch(creds, baseUrl, 'POST', '/20160918/subnets', { compartmentId: compId, vcnId, displayName: 'flowkit-subnet', cidrBlock: '10.0.0.0/24', routeTableId: rt.id, securityListIds: [sl.id] });
    subnetId = sub.id;
  }

  if (!subnetId) {
    const sub = await ociFetch(creds, baseUrl, 'POST', '/20160918/subnets', { compartmentId: compId, vcnId, displayName: 'flowkit-subnet', cidrBlock: '10.0.1.0/24' });
    subnetId = sub.id;
  }

  return { vcnId, subnetId };
}

async function waitForOracle(creds, baseUrl, instId, onLog) {
  const start = Date.now();
  while (Date.now() - start < 300000) {
    const inst = await ociFetch(creds, baseUrl, 'GET', `/20160918/instances/${instId}`);
    onLog(`  State: ${inst.lifecycleState}`);
    if (inst.lifecycleState === 'RUNNING') {
      const vnics = await ociFetch(creds, baseUrl, 'GET', `/20160918/vnicAttachments?instanceId=${instId}`);
      for (const v of vnics) {
        const vd = await ociFetch(creds, baseUrl, 'GET', `/20160918/vnics/${v.vnicId}`);
        if (vd.publicIp) return { instanceId: instId, publicIp: vd.publicIp };
      }
    }
    if (inst.lifecycleState === 'TERMINATED' || inst.lifecycleState === 'STOPPED') throw new Error(`Instance ${inst.lifecycleState.toLowerCase()}`);
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error('Timeout waiting for Oracle instance');
}

async function ociFetch(creds, baseUrl, method, path, body = null) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json', 'Host': new URL(url).host, 'Date': new Date().toUTCString(), 'x-date': new Date().toUTCString() };
  if (body) headers['Content-Length'] = JSON.stringify(body).length.toString();
  const sig = await signOCI(creds, method, path, headers);
  headers['Authorization'] = `Signature version="1",keyId="${creds.tenancy}/${creds.user}/${creds.fingerprint}",algorithm="rsa-sha256",headers="${Object.keys(headers).join(' ')}",signature="${sig}"`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`OCI API error (${res.status}): ${await res.text()}`);
  return res.json();
}

async function signOCI(creds, method, path, headers) {
  const parts = [];
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase().startsWith('x-') || k.toLowerCase() === 'date' || k.toLowerCase() === 'host') {
      parts.push(`${k.toLowerCase()}:${headers[k]}`);
    }
  }
  const signingStr = `${method}\n${path}\n\n${parts.join('\n')}\n`;
  const bin = pemToBinary(creds.privateKey);
  const key = await crypto.subtle.importKey('pkcs8', bin, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingStr));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function pemToBinary(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function generateOracleUserData() {
  return `#!/bin/bash\nset -euxo pipefail\ncurl -fsSL https://raw.githubusercontent.com/RanjanLabz/my-vps-deply-oracla-aws/main/oracle-cloud-setup.sh | bash\n`;
}

// --- AWS ---

const UBUNTU_AMIS = {
  'us-east-1': 'ami-0c7217cdde317cfec', 'us-east-2': 'ami-0d5bf44967753de28',
  'us-west-1': 'ami-0d2728e38c2795188', 'us-west-2': 'ami-03d6f58e1a0f6db7d',
  'eu-west-1': 'ami-0d64bb532e0502c46', 'eu-west-2': 'ami-0ba3b6300b154bc0f',
  'eu-central-1': 'ami-0d9884f4d1e045679', 'ap-southeast-1': 'ami-01b18e46e02e0e477',
  'ap-northeast-1': 'ami-05775226b26593526', 'ap-south-1': 'ami-03d20aba8f41e7d06',
};

async function createAWSInstance(creds, onLog) {
  const { accessKeyId, secretAccessKey, region, instanceType, sshPublicKey } = creds;
  const ec2 = `https://ec2.${region}.amazonaws.com`;
  const amiId = UBUNTU_AMIS[region] || UBUNTU_AMIS['us-east-1'];

  onLog('Authenticating with AWS...');
  onLog(`Using AMI: ${amiId}`);

  onLog('Creating security group...');
  const sgId = await createSG(creds, ec2, onLog);

  const keyName = `flowkit-${Date.now()}`;
  onLog(`Creating key pair: ${keyName}`);
  await importKeyPair(creds, ec2, keyName, sshPublicKey);

  onLog('Creating EC2 instance...');
  const params = {
    'Action': 'RunInstances', 'ImageId': amiId, 'InstanceType': instanceType,
    'KeyName': keyName, 'SecurityGroupId.1': sgId, 'MinCount': '1', 'MaxCount': '1',
    'UserData': btoa(generateAWSUserData()),
    'TagSpecification.1.ResourceType': 'instance',
    'TagSpecification.1.Tag.1.Key': 'Name', 'TagSpecification.1.Tag.1.Value': 'flowkit-deploy',
  };

  const result = await awsFetch(creds, ec2, params);
  const instanceId = result.instancesSet.item.instanceId;
  onLog(`Instance created: ${instanceId}`);

  onLog('Waiting for instance to start (1-2 min)...');
  const publicIp = await waitForAWS(creds, ec2, instanceId, onLog);
  onLog(`Instance running at ${publicIp}`);

  onLog('Waiting for Flow Kit (3-5 min)...');
  await waitForFlowKitReady(publicIp, onLog);

  return { instanceId, publicIp };
}

async function createSG(creds, endpoint, onLog) {
  const vpcRes = await awsFetch(creds, endpoint, { 'Action': 'DescribeVpcs', 'Filter.1.Name': 'isDefault', 'Filter.1.Value.1': 'true' });
  const vpcId = vpcRes.vpcSet.item.vpcId;
  const sgRes = await awsFetch(creds, endpoint, { 'Action': 'CreateSecurityGroup', 'GroupName': `flowkit-sg-${Date.now()}`, 'Description': 'FlowKit', 'VpcId': vpcId });
  const sgId = sgRes.groupId;
  for (const port of [22, 3000, 8100, 9222]) {
    await awsFetch(creds, endpoint, { 'Action': 'AuthorizeSecurityGroupIngress', 'GroupId': sgId, 'IpProtocol': 'tcp', 'FromPort': String(port), 'ToPort': String(port), 'CidrIp': '0.0.0.0/0' });
  }
  onLog(`Security group: ${sgId}`);
  return sgId;
}

async function importKeyPair(creds, endpoint, name, pubKey) {
  await awsFetch(creds, endpoint, { 'Action': 'ImportKeyPair', 'KeyName': name, 'PublicKeyMaterial': btoa(pubKey) });
}

async function waitForAWS(creds, endpoint, instId, onLog) {
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const res = await awsFetch(creds, endpoint, { 'Action': 'DescribeInstances', 'InstanceId.1': instId });
    const item = res.reservationSet?.item;
    if (!item) { await new Promise(r => setTimeout(r, 10000)); continue; }
    const insts = Array.isArray(item.instancesSet?.item) ? item.instancesSet.item : [item.instancesSet?.item].filter(Boolean);
    const inst = insts.find(i => i.instanceId === instId);
    if (!inst) { await new Promise(r => setTimeout(r, 10000)); continue; }
    onLog(`  State: ${inst.instanceState.name}`);
    if (inst.instanceState.name === 'running' && inst.ipAddress) return inst.ipAddress;
    if (inst.instanceState.name === 'terminated' || inst.instanceState.name === 'stopped') throw new Error(`Instance ${inst.instanceState.name}`);
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error('Timeout waiting for AWS instance');
}

async function awsFetch(creds, endpoint, params) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params).toString();
  const now = new Date();
  const ds = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const hdrs = { 'Host': url.host, 'X-Amz-Date': amz };
  const ch = Object.keys(hdrs).sort().map(k => `${k.toLowerCase()}:${hdrs[k]}`).join('\n') + '\n';
  const sh = Object.keys(hdrs).sort().map(k => k.toLowerCase()).join(';');
  const cr = ['GET', url.pathname, url.search.slice(1), ch, sh, 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${ds}/${creds.region}/ec2/aws4_request`;
  const ss = ['AWS4-HMAC-SHA256', amz, scope, await sha256(cr)].join('\n');
  const kDate = await hmac(`AWS4${creds.secretAccessKey}`, ds);
  const kRegion = await hmac(kDate, creds.region);
  const kService = await hmac(kRegion, 'ec2');
  const kSign = await hmac(kService, 'aws4_request');
  const sig = bufToHex(await hmac(kSign, ss, 'hex'));
  hdrs['Authorization'] = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${sh}, Signature=${sig}`;
  const res = await fetch(url.toString(), { headers: hdrs });
  const text = await res.text();
  const r = parseXml(text);
  if (r.error) throw new Error(`AWS error: ${r.error.message}`);
  return r;
}

async function sha256(m) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m)); return bufToHex(b); }
async function hmac(key, data, enc = 'raw') {
  const ck = typeof key === 'string' ? await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) : key;
  const s = await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data));
  return enc === 'hex' ? bufToHex(s) : s;
}
function bufToHex(b) { return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }

function parseXml(xml) {
  const r = {};
  const em = xml.match(/<Error>[\s\S]*?<Code>([\s\S]*?)<\/Code>[\s\S]*?<Message>([\s\S]*?)<\/Message>/);
  if (em) { r.error = { code: em[1], message: em[2] }; return r; }
  const im = xml.match(/<instancesSet>[\s\S]*?<item>[\s\S]*?<instanceId>([\s\S]*?)<\/instanceId>[\s\S]*?<instanceState>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/instanceState>[\s\S]*?<ipAddress>([\s\S]*?)<\/ipAddress>/);
  if (im) r.instancesSet = { item: { instanceId: im[1], instanceState: { name: im[2] }, ipAddress: im[3] || '' } };
  const rm = xml.match(/<reservationSet>[\s\S]*?<item>[\s\S]*?<instancesSet>[\s\S]*?<item>[\s\S]*?<instanceId>([\s\S]*?)<\/instanceId>[\s\S]*?<instanceState>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/instanceState>[\s\S]*?<ipAddress>([\s\S]*?)<\/ipAddress>/);
  if (rm) r.reservationSet = { item: { instancesSet: { item: { instanceId: rm[1], instanceState: { name: rm[2] }, ipAddress: rm[3] || '' } } } };
  const vm = xml.match(/<vpcSet>[\s\S]*?<item>[\s\S]*?<vpcId>([\s\S]*?)<\/vpcId>/);
  if (vm) r.vpcSet = { item: { vpcId: vm[1] } };
  const gm = xml.match(/<groupId>([\s\S]*?)<\/groupId>/);
  if (gm) r.groupId = gm[1];
  return r;
}

function generateAWSUserData() {
  return `#!/bin/bash\nset -euxo pipefail\ncurl -fsSL https://raw.githubusercontent.com/RanjanLabz/my-vps-deply-oracla-aws/main/aws-setup.sh | bash\n`;
}

async function waitForFlowKitReady(ip, onLog) {
  const start = Date.now();
  while (Date.now() - start < 600000) {
    try { const r = await fetch(`http://${ip}:8100/health`, { signal: AbortSignal.timeout(5000) }); if (r.ok) { onLog('Flow Kit ready!'); return; } } catch {}
    onLog('  Waiting for services...');
    await new Promise(r => setTimeout(r, 15000));
  }
  onLog('Warning: Could not verify Flow Kit ready. Instance is running.');
}
