/*
 * AWS EC2 API Integration
 *
 * Uses AWS Signature V4 to authenticate with EC2 API.
 * Creates EC2 instances with user-data scripts for Flow Kit setup.
 */

const AWS_API_VERSION = '2016-11-15';

// Ubuntu 22.04 AMI IDs by region
const UBUNTU_AMIS = {
  'us-east-1': 'ami-0c7217cdde317cfec',
  'us-east-2': 'ami-0d5bf44967753de28',
  'us-west-1': 'ami-0d2728e38c2795188',
  'us-west-2': 'ami-03d6f58e1a0f6db7d',
  'eu-west-1': 'ami-0d64bb532e0502c46',
  'eu-west-2': 'ami-0ba3b6300b154bc0f',
  'eu-central-1': 'ami-0d9884f4d1e045679',
  'ap-southeast-1': 'ami-01b18e46e02e0e477',
  'ap-northeast-1': 'ami-05775226b26593526',
  'ap-south-1': 'ami-03d20aba8f41e7d06',
};

// Ubuntu 24.04 AMI IDs by region
const UBUNTU_24_AMIS = {
  'us-east-1': 'ami-084568db4383264d4',
  'us-east-2': 'ami-0c916b67901d770f8',
  'us-west-1': 'ami-0443305dabd4be2bc',
  'us-west-2': 'ami-0892d3c7ee96c0bf7',
  'eu-west-1': 'ami-0e416228a667e6eee',
  'eu-west-2': 'ami-01b92b84b0f46d7c7',
  'eu-central-1': 'ami-0989b29d37b30d392',
  'ap-southeast-1': 'ami-0622e4856e44a76e5',
  'ap-northeast-1': 'ami-04f7e431dd29a8378',
  'ap-south-1': 'ami-0c332eb40b8b73564',
};

/**
 * Create an EC2 instance on AWS.
 */
export async function createAWSInstance(creds, onLog) {
  const { accessKeyId, secretAccessKey, region, instanceType, ami, sshPublicKey } = creds;

  onLog('Authenticating with AWS...');

  const ec2Endpoint = `https://ec2.${region}.amazonaws.com`;

  // Get AMI ID
  const amiId = ami === 'ubuntu-24.04'
    ? (UBUNTU_24_AMIS[region] || UBUNTU_24_AMIS['us-east-1'])
    : (UBUNTU_AMIS[region] || UBUNTU_AMIS['us-east-1']);

  onLog(`Using AMI: ${amiId}`);

  // Create security group
  onLog('Creating security group...');
  const sgId = await createSecurityGroup(creds, ec2Endpoint, onLog);

  // Create key pair (import user's public key)
  const keyName = `flowkit-${Date.now()}`;
  onLog(`Creating key pair: ${keyName}`);
  await createKeyPair(creds, ec2Endpoint, keyName, sshPublicKey, onLog);

  // Create instance
  onLog('Creating EC2 instance...');
  const userData = generateUserData();

  const params = {
    'Action': 'RunInstances',
    'ImageId': amiId,
    'InstanceType': instanceType,
    'KeyName': keyName,
    'SecurityGroupId.1': sgId,
    'MinCount': '1',
    'MaxCount': '1',
    'UserData': btoa(userData),
    'TagSpecification.1.ResourceType': 'instance',
    'TagSpecification.1.Tag.1.Key': 'Name',
    'TagSpecification.1.Tag.1.Value': 'flowkit-deploy',
  };

  const result = await awsEC2Fetch(creds, ec2Endpoint, params, onLog);
  const instanceId = result.instancesSet.item.instanceId;
  onLog(`Instance created: ${instanceId}`);

  // Wait for instance to be running
  onLog('Waiting for instance to start (this may take 1-2 minutes)...');
  const publicIp = await waitForAWSInstance(creds, ec2Endpoint, instanceId, onLog);

  onLog(`Instance is running at ${publicIp}`);

  // Open firewall ports (security group already handles this)

  // Wait for Flow Kit to be ready
  onLog('Waiting for Flow Kit services to start (this may take 3-5 minutes)...');
  await waitForFlowKitReady(publicIp, onLog);

  return { instanceId, publicIp };
}

/**
 * Create a security group with required ports.
 */
async function createSecurityGroup(creds, endpoint, onLog) {
  // Get default VPC
  const vpcResult = await awsEC2Fetch(creds, endpoint, {
    'Action': 'DescribeVpcs',
    'Filter.1.Name': 'isDefault',
    'Filter.1.Value.1': 'true',
  }, onLog);

  const vpcId = vpcResult.vpcSet.item.vpcId;

  // Create security group
  const sgResult = await awsEC2Fetch(creds, endpoint, {
    'Action': 'CreateSecurityGroup',
    'GroupName': `flowkit-sg-${Date.now()}`,
    'Description': 'Flow Kit deployment security group',
    'VpcId': vpcId,
  }, onLog);

  const sgId = sgResult.groupId;

  // Add ingress rules
  const ports = [
    { port: 22, desc: 'SSH' },
    { port: 3000, desc: 'Frontend' },
    { port: 8100, desc: 'Backend API' },
    { port: 9222, desc: 'WebSocket' },
  ];

  for (const { port } of ports) {
    await awsEC2Fetch(creds, endpoint, {
      'Action': 'AuthorizeSecurityGroupIngress',
      'GroupId': sgId,
      'IpProtocol': 'tcp',
      'FromPort': String(port),
      'ToPort': String(port),
      'CidrIp': '0.0.0.0/0',
    }, onLog);
  }

  onLog(`Security group created: ${sgId}`);
  return sgId;
}

/**
 * Import SSH public key as a key pair.
 */
async function createKeyPair(creds, endpoint, keyName, publicKey, onLog) {
  await awsEC2Fetch(creds, endpoint, {
    'Action': 'ImportKeyPair',
    'KeyName': keyName,
    'PublicKeyMaterial': btoa(publicKey),
  }, onLog);

  onLog(`Key pair imported: ${keyName}`);
}

/**
 * Wait for EC2 instance to reach running state.
 */
async function waitForAWSInstance(creds, endpoint, instanceId, onLog) {
  const maxWait = 180000; // 3 minutes
  const interval = 10000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const result = await awsEC2Fetch(creds, endpoint, {
      'Action': 'DescribeInstances',
      'InstanceId.1': instanceId,
    }, onLog);

    const reservation = result.reservationSet?.item;
    if (!reservation) {
      await new Promise(r => setTimeout(r, interval));
      continue;
    }

    const instances = Array.isArray(reservation.instancesSet?.item)
      ? reservation.instancesSet.item
      : [reservation.instancesSet?.item].filter(Boolean);

    const instance = instances.find(i => i.instanceId === instanceId);
    if (!instance) {
      await new Promise(r => setTimeout(r, interval));
      continue;
    }

    onLog(`  Instance state: ${instance.instanceState.name}`);

    if (instance.instanceState.name === 'running' && instance.ipAddress) {
      return instance.ipAddress;
    }

    if (instance.instanceState.name === 'terminated' || instance.instanceState.name === 'stopped') {
      throw new Error(`Instance ${instance.instanceState.name}`);
    }

    await new Promise(r => setTimeout(r, interval));
  }

  throw new Error('Timeout waiting for AWS instance');
}

/**
 * Wait for Flow Kit services to be ready.
 */
async function waitForFlowKitReady(publicIp, onLog) {
  const maxWait = 600000;
  const interval = 15000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`http://${publicIp}:8100/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        onLog('Flow Kit backend is ready!');
        return;
      }
    } catch (e) {
      // Not ready yet
    }
    onLog('  Waiting for Flow Kit services to start...');
    await new Promise(r => setTimeout(r, interval));
  }

  onLog('Warning: Could not verify Flow Kit is ready. Instance is running.');
}

/**
 * Make signed AWS EC2 API request using Signature V4.
 */
async function awsEC2Fetch(creds, endpoint, params, onLog) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params).toString();

  const now = new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';

  const headers = {
    'Host': url.host,
    'X-Amz-Date': amzDate,
  };

  // AWS Signature V4 signing
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(k => `${k.toLowerCase()}:${headers[k]}`)
    .join('\n') + '\n';

  const signedHeaders = Object.keys(headers)
    .sort()
    .map(k => k.toLowerCase())
    .join(';');

  const canonicalRequest = [
    'GET',
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const credentialScope = `${dateStamp}/${creds.region}/ec2/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join('\n');

  const kDate = await hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, creds.region);
  const kService = await hmac(kRegion, 'ec2');
  const kSigning = await hmac(kService, 'aws4_request');

  const signature = bufToHex(await hmac(kSigning, stringToSign, 'hex'));

  headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url.toString(), { headers });

  const text = await response.text();

  // Parse XML response
  const result = parseXmlResponse(text);

  if (result.error) {
    throw new Error(`AWS EC2 error: ${result.error.message}`);
  }

  return result;
}

// Crypto helpers
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return bufToHex(hashBuffer);
}

async function hmac(key, data, encoding = 'raw') {
  const cryptoKey = typeof key === 'string'
    ? await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    : key;

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));

  if (encoding === 'hex') return bufToHex(signature);
  return signature;
}

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Simple XML parser for AWS responses
function parseXmlResponse(xml) {
  const result = {};

  // Check for error
  const errorMatch = xml.match(/<Error>[\s\S]*?<Code>([\s\S]*?)<\/Code>[\s\S]*?<Message>([\s\S]*?)<\/Message>[\s\S]*?<\/Error>/);
  if (errorMatch) {
    result.error = { code: errorMatch[1], message: errorMatch[2] };
    return result;
  }

  // Parse instances
  const instanceMatch = xml.match(/<instancesSet>[\s\S]*?<item>[\s\S]*?<instanceId>([\s\S]*?)<\/instanceId>[\s\S]*?<instanceState>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/instanceState>[\s\S]*?<ipAddress>([\s\S]*?)<\/ipAddress>[\s\S]*?<\/item>[\s\S]*?<\/instancesSet>/);
  if (instanceMatch) {
    result.instancesSet = {
      item: {
        instanceId: instanceMatch[1],
        instanceState: { name: instanceMatch[2] },
        ipAddress: instanceMatch[3] || '',
      },
    };
  }

  // Parse reservation set
  const reservationMatch = xml.match(/<reservationSet>[\s\S]*?<item>[\s\S]*?<instancesSet>[\s\S]*?<item>[\s\S]*?<instanceId>([\s\S]*?)<\/instanceId>[\s\S]*?<instanceState>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/instanceState>[\s\S]*?<ipAddress>([\s\S]*?)<\/ipAddress>[\s\S]*?<\/item>[\s\S]*?<\/instancesSet>[\s\S]*?<\/item>[\s\S]*?<\/reservationSet>/);
  if (reservationMatch) {
    result.reservationSet = {
      item: {
        instancesSet: {
          item: {
            instanceId: reservationMatch[1],
            instanceState: { name: reservationMatch[2] },
            ipAddress: reservationMatch[3] || '',
          },
        },
      },
    };
  }

  // Parse VPC
  const vpcMatch = xml.match(/<vpcSet>[\s\S]*?<item>[\s\S]*?<vpcId>([\s\S]*?)<\/vpcId>[\s\S]*?<\/item>[\s\S]*?<\/vpcSet>/);
  if (vpcMatch) {
    result.vpcSet = { item: { vpcId: vpcMatch[1] } };
  }

  // Parse group ID
  const groupMatch = xml.match(/<groupId>([\s\S]*?)<\/groupId>/);
  if (groupMatch) {
    result.groupId = groupMatch[1];
  }

  return result;
}

function generateUserData() {
  return `#!/bin/bash
set -euxo pipefail
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/final-production/main/aws-setup.sh | bash
`;
}
