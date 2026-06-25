/*
 * Oracle Cloud Infrastructure API Integration
 *
 * Uses OCI REST API to create compute instances.
 * Authentication: RSA-SHA256 signing (required for OCI API).
 */

import * as jose from 'jose';

const OCI_API_VERSION = '20160918';

/**
 * Create a compute instance on Oracle Cloud.
 */
export async function createOracleInstance(creds, onLog) {
  const { tenancy, user, privateKey, fingerprint, region, shape, image, ocpus, sshPublicKey, compartment } = creds;
  const compartmentId = compartment || tenancy;

  onLog('Authenticating with Oracle Cloud API...');

  // Build OCI API request
  const baseUrl = `https://iaas.${region}.oraclecloud.com`;
  const availabilityDomain = await getAvailabilityDomain(creds, baseUrl, onLog);
  onLog(`Using availability domain: ${availabilityDomain}`);

  // Get the latest Ubuntu image
  const imageVersion = image || 'Ubuntu 22.04';
  const imageId = await getUbuntuImageId(creds, baseUrl, imageVersion, onLog);
  onLog(`Using image: ${imageId}`);

  // Get or create VCN
  const networkInfo = await ensureNetwork(creds, baseUrl, compartmentId, onLog);

  const instanceBody = {
    displayName: 'flowkit-deploy',
    compartmentId,
    shape,
    shapeConfig: shape.includes('Flex') ? { ocpus, memoryInGBs: ocpus * 6 } : undefined,
    sourceDetails: {
      sourceType: 'image',
      imageId,
    },
    createVnicDetails: {
      subnetId: networkInfo.subnetId,
      assignPublicIp: true,
      displayName: 'flowkit-vnic',
    },
    metadata: {
      ssh_authorized_keys: sshPublicKey,
      user_data: btoa(generateOracleUserData()),
    },
  };

  onLog('Creating compute instance...');

  const response = await ociFetch(creds, baseUrl, 'POST', `/20160918/instances`, instanceBody);
  const instance = response;
  onLog(`Instance created: ${instance.id}`);

  // Wait for instance to be RUNNING
  onLog('Waiting for instance to start (this may take 2-3 minutes)...');
  const result = await waitForOracleInstance(creds, baseUrl, instance.id, onLog);

  // Get public IP
  onLog(`Instance is running at ${result.publicIp}`);
  onLog('Waiting for setup script to complete (this may take 3-5 minutes)...');

  // Wait for Flow Kit to be ready
  await waitForFlowKitReady(result.publicIp, onLog);

  return result;
}

/**
 * Get availability domain for the compartment.
 */
async function getAvailabilityDomain(creds, baseUrl, onLog) {
  // Try API first, fallback to known AD
  try {
    const compartmentId = creds.compartment || creds.tenancy;
    const response = await ociFetch(
      creds, baseUrl, 'GET',
      `/20160918/availabilityDomains?compartmentId=${compartmentId}`
    );
    return response[0].name;
  } catch (e) {
    onLog(`AD API failed (${e.message}), using default AD`);
    return 'ffod:AP-SINGAPORE-1-AD-1';
  }
}

/**
 * Get the latest Ubuntu image OCID.
 */
async function getUbuntuImageId(creds, baseUrl, imageVersion, onLog) {
  const osVersion = (imageVersion || '22.04').replace('Ubuntu ', '');
  // operatingSystem is "Canonical Ubuntu", query with compartmentId
  const response = await ociFetch(
    creds, baseUrl, 'GET',
    `/20160918/images?compartmentId=${creds.tenancy}&operatingSystem=Canonical Ubuntu&operatingSystemVersion=${osVersion}&sortBy=timeCreated&sortOrder=DESC`
  );

  if (!response || response.length === 0) {
    throw new Error(`No Ubuntu ${imageVersion} image found`);
  }

  return response[0].id;
}

/**
 * Ensure VCN, subnet, and security list exist.
 */
async function ensureNetwork(creds, baseUrl, compartmentId, onLog) {
  onLog('Checking network configuration...');

  // Get existing VCNs
  const vcns = await ociFetch(
    creds, baseUrl, 'GET',
    `/20160918/vcns?compartmentId=${compartmentId}`
  );

  let vcnId, subnetId;

  if (vcns && vcns.length > 0) {
    // Use existing VCN
    vcnId = vcns[0].id;
    onLog(`Using existing VCN: ${vcnId}`);

    // Get subnets
    const subnets = await ociFetch(
      creds, baseUrl, 'GET',
      `/20160918/subnets?compartmentId=${compartmentId}&vcnId=${vcnId}`
    );

    if (subnets && subnets.length > 0) {
      subnetId = subnets[0].id;
      onLog(`Using existing subnet: ${subnetId}`);
    }
  }

  if (!vcnId) {
    // Create VCN
    onLog('Creating VCN...');
    const vcn = await ociFetch(creds, baseUrl, 'POST', '/20160918/vcns', {
      compartmentId,
      displayName: 'flowkit-vcn',
      cidrBlock: '10.0.0.0/16',
    });
    vcnId = vcn.id;
    onLog(`VCN created: ${vcnId}`);

    // Create internet gateway
    const igw = await ociFetch(creds, baseUrl, 'POST', '/20160918/internetgateways', {
      compartmentId,
      vcnId,
      displayName: 'flowkit-igw',
      isEnabled: true,
    });

    // Create route table
    const rt = await ociFetch(creds, baseUrl, 'POST', '/20160918/routetables', {
      compartmentId,
      vcnId,
      displayName: 'flowkit-rt',
      routeRules: [{
        destination: '0.0.0.0/0',
        destinationType: 'CIDR_BLOCK',
        networkEntityId: igw.id,
      }],
    });

    // Create security list
    const sl = await ociFetch(creds, baseUrl, 'POST', '/20160918/securitylists', {
      compartmentId,
      vcnId,
      displayName: 'flowkit-sl',
      ingressSecurityRules: [
        { protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 22, max: 22 } } },
        { protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 3000, max: 3000 } } },
        { protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 8100, max: 8100 } } },
        { protocol: '6', source: '0.0.0.0/0', tcpOptions: { destinationPortRange: { min: 9222, max: 9222 } } },
        { protocol: '1', source: '0.0.0.0/0' }, // ICMP
      ],
      egressSecurityRules: [
        { protocol: 'all', destination: '0.0.0.0/0' },
      ],
    });

    // Create subnet
    const subnet = await ociFetch(creds, baseUrl, 'POST', '/20160918/subnets', {
      compartmentId,
      vcnId,
      displayName: 'flowkit-subnet',
      cidrBlock: '10.0.0.0/24',
      routeTableId: rt.id,
      securityListIds: [sl.id],
    });
    subnetId = subnet.id;
    onLog(`Subnet created: ${subnetId}`);
  }

  if (!subnetId) {
    // Create subnet in existing VCN
    const subnet = await ociFetch(creds, baseUrl, 'POST', '/20160918/subnets', {
      compartmentId,
      vcnId,
      displayName: 'flowkit-subnet',
      cidrBlock: '10.0.1.0/24',
    });
    subnetId = subnet.id;
  }

  return { vcnId, subnetId };
}

/**
 * Wait for Oracle instance to reach RUNNING state.
 */
async function waitForOracleInstance(creds, baseUrl, instanceId, onLog) {
  const maxWait = 300000;
  const interval = 10000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const instance = await ociFetch(creds, baseUrl, 'GET', `/20160918/instances/${instanceId}`);

    onLog(`  Instance state: ${instance.lifecycleState}`);

    if (instance.lifecycleState === 'RUNNING') {
      // Get public IP from VNIC attachments
      const vnics = await ociFetch(
        creds, baseUrl, 'GET',
        `/20160918/vnicAttachments?instanceId=${instanceId}`
      );

      for (const vnic of vnics) {
        const vnicDetail = await ociFetch(creds, baseUrl, 'GET', `/20160918/vnics/${vnic.vnicId}`);
        if (vnicDetail.publicIp) {
          return { instanceId, publicIp: vnicDetail.publicIp };
        }
      }
    }

    if (instance.lifecycleState === 'TERMINATED' || instance.lifecycleState === 'STOPPED') {
      throw new Error(`Instance ${instance.lifecycleState.toLowerCase()}`);
    }

    await new Promise(r => setTimeout(r, interval));
  }

  throw new Error('Timeout waiting for Oracle instance');
}

/**
 * Wait for Flow Kit services to be ready on the VPS.
 */
async function waitForFlowKitReady(publicIp, onLog) {
  const maxWait = 600000; // 10 minutes
  const interval = 15000; // 15 seconds
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
 * Make authenticated OCI API request with RSA-SHA256 signing.
 */
async function ociFetch(creds, baseUrl, method, path, body = null) {
  const url = `${baseUrl}${path}`;
  const now = new Date().toUTCString();
  const headers = {
    'Host': new URL(url).host,
    'Date': now,
  };

  if (method !== 'GET' && body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = new TextEncoder().encode(JSON.stringify(body)).byteLength.toString();
  }

  // Sign the request
  const signature = await signOCIRequest(creds, method, path, headers);
  headers['Authorization'] = `Signature version="1",keyId="${creds.tenancy}/${creds.user}/${creds.fingerprint}",algorithm="rsa-sha256",headers="(request-target) host date",signature="${signature}"`;

  const options = {
    method,
    headers,
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OCI API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Sign OCI API request using RSA-SHA256.
 * Uses Web Crypto API (available in Cloudflare Workers).
 */
async function signOCIRequest(creds, method, path, headers) {
  const signingString = [
    `(request-target): ${method.toLowerCase()} ${path}`,
    `host: ${headers['Host']}`,
    `date: ${headers['Date']}`
  ].join('\n');

  // Import private key using jose to get a CryptoKey, then export PKCS8 and re-import for raw signing
  const privateKey = await jose.importPKCS8(creds.privateKey, 'RS256', true);

  // Export the key as JWK, then re-import for raw Web Crypto signing
  const jwk = await jose.exportJWK(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const rawSig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingString)
  );

  const sigArray = new Uint8Array(rawSig);
  let binary = '';
  for (let i = 0; i < sigArray.length; i++) {
    binary += String.fromCharCode(sigArray[i]);
  }
  return btoa(binary);
}

function generateOracleUserData() {
  return `#!/bin/bash
set -euxo pipefail
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/final-production/main/oracle-cloud-setup.sh | bash
`;
}
