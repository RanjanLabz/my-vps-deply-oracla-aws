/* Flow Kit — Deploy Portal App Logic */

// ============================================================
// Configuration
// ============================================================
const WORKER_URL = window.DEPLOY_CONFIG?.WORKER_URL || '';
let currentProvider = 'worker';

// ============================================================
// Tab Switching
// ============================================================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    currentProvider = target;

    // Update tab active state
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Show corresponding form
    document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
    document.getElementById(`form-${target}`).classList.add('active');

    // Hide progress/result/error
    hideAll();
  });
});

// ============================================================
// Form Submissions
// ============================================================
document.getElementById('form-worker').addEventListener('submit', (e) => {
  e.preventDefault();
  deployWorker();
});

document.getElementById('form-oracle').addEventListener('submit', (e) => {
  e.preventDefault();
  startDeploy('oracle');
});

document.getElementById('form-aws').addEventListener('submit', (e) => {
  e.preventDefault();
  startDeploy('aws');
});

document.getElementById('form-existing').addEventListener('submit', (e) => {
  e.preventDefault();
  startDeploy('existing');
});

// ============================================================
// Worker Deployment (via Cloudflare API)
// ============================================================
async function deployWorker() {
  const accountId = document.getElementById('cf-account-id').value.trim();
  const apiToken = document.getElementById('cf-api-token').value.trim();
  const workerName = document.getElementById('cf-worker-name').value.trim() || 'flowkit-deploy';

  if (!accountId || !apiToken) {
    alert('Cloudflare Account ID and API Token are required');
    return;
  }

  const btn = document.querySelector('#form-worker .btn-deploy');
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = true;
  text.hidden = true;
  loader.hidden = false;

  const dot = document.getElementById('worker-dot');
  const statusText = document.getElementById('worker-status-text');
  const urlDisplay = document.getElementById('worker-url-display');

  dot.className = 'status-dot deploying';
  statusText.textContent = 'Deploying worker...';
  urlDisplay.hidden = true;

  try {
    // Step 1: Verify credentials
    statusText.textContent = 'Verifying Cloudflare credentials...';
    const verifyRes = await fetch(`https://api.cloudflare.com/client/v4/accounts?page=1&per_page=5`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      throw new Error('Invalid Cloudflare API token. Check your token has Workers Scripts:Edit and KV Storage:Edit permissions.');
    }

    // Step 2: Ensure KV namespace
    statusText.textContent = 'Ensuring KV namespace exists...';
    let kvId = await findKVNamespace(accountId, apiToken, 'DEPLOY_JOBS');
    if (!kvId) {
      const createRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/kv/namespaces`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'DEPLOY_JOBS' }),
      });
      const createData = await createRes.json();
      if (!createData.success) {
        throw new Error('Failed to create KV namespace: ' + (createData.errors?.map(e => e.message).join(', ') || 'Unknown error'));
      }
      kvId = createData.result.id;
    }
    statusText.textContent = `KV namespace ready: ${kvId}`;

    // Step 3: Upload worker with KV binding
    statusText.textContent = 'Uploading worker script...';
    let scriptContent;
    try {
      const scriptRes = await fetch('https://raw.githubusercontent.com/RanjanLabz/my-vps-deply-oracla-aws/main/workers/dist/bundle.js');
      if (scriptRes.ok) {
        scriptContent = await scriptRes.text();
      } else {
        scriptContent = getInlineWorkerScript();
      }
    } catch (e) {
      scriptContent = getInlineWorkerScript();
    }

    const metadata = {
      main_module: 'index.js',
      compatibility_date: '2024-01-01',
      bindings: [
        {
          type: 'kv_namespace',
          name: 'DEPLOY_JOBS',
          namespace_id: kvId,
        },
      ],
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('index.js', new Blob([scriptContent], { type: 'application/javascript+module' }), 'index.js');

    const uploadRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${apiToken}` },
      body: form,
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.success) {
      throw new Error('Failed to upload worker: ' + (uploadData.errors?.map(e => e.message).join(', ') || 'Unknown error'));
    }
    statusText.textContent = 'Worker script uploaded!';

    // Step 4: Get worker URL
    statusText.textContent = 'Getting worker URL...';
    const subdomainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });
    const subdomainData = await subdomainRes.json();

    let workerUrl;
    if (subdomainData.success && subdomainData.result?.subdomain) {
      workerUrl = `https://${workerName}.${subdomainData.result.subdomain}.workers.dev`;
    } else {
      workerUrl = `https://${workerName}.workers.dev`;
    }

    // Step 5: Test health
    statusText.textContent = 'Testing worker health...';
    try {
      const healthRes = await fetch(`${workerUrl}/api/health`, { signal: AbortSignal.timeout(10000) });
      if (healthRes.ok) {
        statusText.textContent = 'Worker is healthy and ready!';
      } else {
        statusText.textContent = 'Worker deployed (health check returned ' + healthRes.status + ')';
      }
    } catch (e) {
      statusText.textContent = 'Worker deployed (health check pending — may take a few seconds)';
    }

    // Show URL
    dot.className = 'status-dot active';
    urlDisplay.hidden = false;
    document.getElementById('worker-url-text').textContent = workerUrl;

    // Save to config.js
    statusText.textContent = `Done! Worker URL: ${workerUrl}`;

  } catch (err) {
    dot.className = 'status-dot';
    statusText.textContent = 'Deployment failed: ' + err.message;
    alert('Worker deployment failed: ' + err.message);
  } finally {
    btn.disabled = false;
    text.hidden = false;
    loader.hidden = true;
  }
}

async function findKVNamespace(accountId, apiToken, name) {
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/kv/namespaces?page=${page}&per_page=100`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });
    const data = await res.json();
    if (!data.success) break;
    const found = data.result.find(ns => ns.title === name);
    if (found) return found.id;
    if (!data.result_info || page >= data.result_info.total_pages) break;
    page++;
  }
  return null;
}

// ============================================================
// Deploy Flow (via Cloudflare Worker)
// ============================================================
async function startDeploy(provider) {
  const credentials = getCredentials(provider);

  // Check worker URL is configured
  if (!WORKER_URL) {
    alert('Deployment backend not configured. Deploy the Cloudflare Worker first using the "Setup Worker" tab.');
    return;
  }

  // Validate
  const error = validateCredentials(provider, credentials);
  if (error) {
    alert(error);
    return;
  }

  // Show progress
  hideAll();
  showProgress();
  setLoading(provider, true);

  try {
    const response = await fetch(`${WORKER_URL}/api/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, credentials }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || 'Deployment failed');
    }

    // Stream the response (SSE)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          handleProgressEvent(data);
        }
      }
    }

    if (buffer.startsWith('data: ')) {
      const data = JSON.parse(buffer.slice(6));
      handleProgressEvent(data);
    }

  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(provider, false);
  }
}

// ============================================================
// Get Credentials from Form
// ============================================================
function getCredentials(provider) {
  switch (provider) {
    case 'oracle':
      return {
        tenancy: document.getElementById('oci-tenancy').value.trim(),
        user: document.getElementById('oci-user').value.trim(),
        privateKey: document.getElementById('oci-key').value.trim(),
        fingerprint: document.getElementById('oci-fingerprint').value.trim(),
        compartment: document.getElementById('oci-compartment').value.trim(),
        region: document.getElementById('oci-region').value,
        shape: document.getElementById('oci-shape').value,
        image: document.getElementById('oci-image').value,
        ocpus: parseInt(document.getElementById('oci-ocpus').value) || 1,
        sshPublicKey: document.getElementById('oci-ssh').value.trim(),
      };

    case 'aws':
      return {
        accessKeyId: document.getElementById('aws-access').value.trim(),
        secretAccessKey: document.getElementById('aws-secret').value.trim(),
        region: document.getElementById('aws-region').value,
        instanceType: document.getElementById('aws-instance').value,
        ami: document.getElementById('aws-ami').value,
        sshPublicKey: document.getElementById('aws-ssh').value.trim(),
      };

    case 'existing':
      return {
        ip: document.getElementById('vps-ip').value.trim(),
        user: document.getElementById('vps-user').value.trim(),
        port: parseInt(document.getElementById('vps-port').value) || 22,
        provider: document.getElementById('vps-provider').value,
        sshPrivateKey: document.getElementById('vps-ssh-key').value.trim(),
      };
  }
}

// ============================================================
// Validate Credentials
// ============================================================
function validateCredentials(provider, creds) {
  switch (provider) {
    case 'oracle':
      if (!creds.tenancy) return 'Tenancy OCID is required';
      if (!creds.user) return 'User OCID is required';
      if (!creds.privateKey) return 'Private key is required';
      if (!creds.fingerprint) return 'API key fingerprint is required';
      if (!creds.sshPublicKey) return 'SSH public key is required';
      if (!creds.tenancy.startsWith('ocid1.tenancy')) return 'Invalid Tenancy OCID format';
      if (!creds.user.startsWith('ocid1.user')) return 'Invalid User OCID format';
      return null;

    case 'aws':
      if (!creds.accessKeyId) return 'Access Key ID is required';
      if (!creds.secretAccessKey) return 'Secret Access Key is required';
      if (!creds.sshPublicKey) return 'SSH public key is required';
      if (!creds.accessKeyId.startsWith('AKIA')) return 'Invalid Access Key ID format';
      return null;

    case 'existing':
      if (!creds.ip) return 'VPS IP address is required';
      if (!creds.user) return 'SSH username is required';
      if (!creds.sshPrivateKey) return 'SSH private key is required';
      if (!isValidIP(creds.ip)) return 'Invalid IP address format';
      return null;
  }
}

function isValidIP(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

// ============================================================
// Progress Handling
// ============================================================
function handleProgressEvent(data) {
  switch (data.type) {
    case 'log':
      appendLog(data.message, data.level || 'info');
      break;
    case 'step':
      appendLog(`[Step] ${data.message}`, 'step');
      break;
    case 'success':
      showResult(data);
      break;
    case 'error':
      showError(data.message);
      break;
  }
}

// ============================================================
// UI Helpers
// ============================================================
function hideAll() {
  document.getElementById('progress').hidden = true;
  document.getElementById('result').hidden = true;
  document.getElementById('error').hidden = true;
}

function showProgress() {
  const el = document.getElementById('progress');
  el.hidden = false;
  document.getElementById('progress-log').innerHTML = '';
  const badge = document.getElementById('progress-status');
  badge.textContent = 'Running';
  badge.className = 'status-badge';
}

function appendLog(message, level = 'info') {
  const log = document.getElementById('progress-log');
  const line = document.createElement('div');
  line.className = level;
  line.textContent = message;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function showResult(data) {
  hideAll();
  const el = document.getElementById('result');
  el.hidden = false;

  document.getElementById('result-ip').textContent = data.vpsIp;
  document.getElementById('result-frontend').textContent = `http://${data.vpsIp}:3000`;
  document.getElementById('result-frontend').href = `http://${data.vpsIp}:3000`;
  document.getElementById('result-backend').textContent = `http://${data.vpsIp}:8100`;
  document.getElementById('result-backend').href = `http://${data.vpsIp}:8100`;
  document.getElementById('result-token').textContent = data.authToken;

  const wsUrl = `ws://${data.vpsIp}:9222`;
  const callbackUrl = `http://${data.vpsIp}:8100/api/ext/callback`;
  const cmd = `chrome.storage.local.set({
  config_ws_url: '${wsUrl}',
  config_http_callback_url: '${callbackUrl}',
  config_auth_token: '${data.authToken}'
});`;
  document.getElementById('result-cmd').textContent = cmd;
}

function showError(message) {
  hideAll();
  const el = document.getElementById('error');
  el.hidden = false;
  document.getElementById('error-message').textContent = message;
}

function setLoading(provider, loading) {
  const formId = `form-${provider}`;
  const form = document.getElementById(formId);
  const btn = form.querySelector('.btn-deploy');
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');

  btn.disabled = loading;
  text.hidden = loading;
  loader.hidden = !loading;
}

function resetUI() {
  hideAll();
  document.getElementById(`form-${currentProvider}`).classList.add('active');
}

function copyText(elementId) {
  const el = document.getElementById(elementId);
  const text = el.textContent || el.value;
  navigator.clipboard.writeText(text).then(() => {
    const btn = el.parentElement.querySelector('.btn-copy');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

function showDocs() {
  alert('Documentation coming soon!');
}

// ============================================================
// Inline Worker Script (fallback if bundle.js not found)
// ============================================================
function getInlineWorkerScript() {
  return `const CORS_HEADERS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
export default{async fetch(request,env,ctx){if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS_HEADERS});const url=new URL(request.url);if(request.method==='GET'&&url.pathname==='/api/health')return new Response(JSON.stringify({status:'ok',timestamp:Date.now()}),{headers:{'Content-Type':'application/json',...CORS_HEADERS}});if(request.method==='POST'&&url.pathname==='/api/deploy')return handleDeploy(request,env,ctx);if(request.method==='GET'&&url.pathname.startsWith('/api/status/')){const jobId=url.pathname.split('/').pop();const job=await env.DEPLOY_JOBS?.get('job:'+jobId,{type:'json'});if(!job)return new Response(JSON.stringify({message:'Not found'}),{status:404,headers:{'Content-Type':'application/json',...CORS_HEADERS}});return new Response(JSON.stringify(job),{headers:{'Content-Type':'application/json',...CORS_HEADERS}});}return new Response('Not Found',{status:404,headers:CORS_HEADERS})}};
async function handleDeploy(request,env,ctx){let body;try{body=await request.json()}catch{return new Response(JSON.stringify({message:'Invalid JSON'}),{status:400,headers:{'Content-Type':'application/json',...CORS_HEADERS}});}const{provider,credentials}=body;const ip=request.headers.get('cf-connecting-ip')||'unknown';const rl=await checkRateLimit(env,ip);if(!rl.allowed)return new Response(JSON.stringify({message:'Rate limited'}),{status:429,headers:{'Content-Type':'application/json',...CORS_HEADERS}});const{readable,writable}=new TransformStream();const writer=writable.getWriter();const enc=new TextEncoder();const send=async(d)=>{try{await writer.write(enc.encode('data: '+JSON.stringify(d)+'\\n\\n'))}catch{}};ctx.waitUntil((async()=>{try{if(provider==='oracle'){send({type:'log',message:'Starting Oracle deployment...',level:'step'});const result=await createOracleInstance(credentials,(m,l)=>send({type:'log',message:String(m).replace(/[\\r\\n]+/g,' ').substring(0,500),level:l||'info'}));send({type:'success',vpsIp:result.publicIp,instanceId:result.instanceId,authToken:generateToken()});}else if(provider==='aws'){send({type:'log',message:'Starting AWS deployment...',level:'step'});const result=await createAWSInstance(credentials,(m,l)=>send({type:'log',message:String(m).replace(/[\\r\\n]+/g,' ').substring(0,500),level:l||'info'}));send({type:'success',vpsIp:result.publicIp,instanceId:result.instanceId,authToken:generateToken()});}else if(provider==='existing'){send({type:'log',message:'Generate install command',level:'step'});send({type:'success',vpsIp:credentials.ip,authToken:'Run the command'});}}catch(err){send({type:'error',message:err.message})}finally{await writer.close()}})());return new Response(readable,{status:200,headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive',...CORS_HEADERS}});}
function generateToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function checkRateLimit(env,ip){if(!env.DEPLOY_JOBS)return{allowed:true};return{allowed:true}}
async function createOracleInstance(creds,onLog){onLog('Oracle deployment not available in inline mode');throw new Error('Please deploy the full worker via the Setup Worker tab')}
async function createAWSInstance(creds,onLog){onLog('AWS deployment not available in inline mode');throw new Error('Please deploy the full worker via the Setup Worker tab')}`;
}
