/*
 * SSH Module for Cloudflare Worker
 *
 * Cloudflare Workers cannot run native SSH (no TCP sockets).
 * Instead, this module provides two approaches:
 *
 * 1. Oracle/AWS deployments: Use cloud provider user-data scripts
 *    (instance runs setup on first boot — no SSH needed)
 *
 * 2. Existing VPS: Generate a one-liner command for the user to run,
 *    OR use a WebSocket SSH proxy (optional)
 */

// Generate the setup script inline (fetched from GitHub at deploy time)
const SETUP_SCRIPTS = {
  oracle: 'oracle-cloud-setup.sh',
  aws: 'aws-setup.sh',
};

/**
 * Generate user-data script for cloud instances.
 * The cloud provider runs this script on first boot.
 */
export function generateUserData(provider, repoUrl = 'https://github.com/YOUR_USERNAME/final-production.git') {
  const setupUrl = `https://raw.githubusercontent.com/YOUR_USERNAME/final-production/main/${SETUP_SCRIPTS[provider]}`;

  return `#!/bin/bash
set -euxo pipefail

# Download and run Flow Kit setup script
curl -fsSL "${setupUrl}" -o /tmp/flowkit-setup.sh
chmod +x /tmp/flowkit-setup.sh
bash /tmp/flowkit-setup.sh --repo "${repoUrl}"

# Signal completion via cloud provider metadata (if available)
echo "Flow Kit setup complete at $(date)" > /tmp/flowkit-setup.done
`;
}

/**
 * For existing VPS — generate a one-liner command the user can paste.
 */
export function generateInstallCommand(ip, user, sshKey) {
  return `ssh -o StrictHostKeyChecking=no ${user}@${ip} 'curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/final-production/main/oracle-cloud-setup.sh | bash'`;
}

/**
 * Poll instance status via cloud provider API.
 * Returns public IP when instance is ready.
 */
export async function waitForInstance(provider, credentials, instanceId, onLog) {
  const maxWait = 300000; // 5 minutes
  const interval = 10000; // 10 seconds
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    let status, publicIp;

    if (provider === 'oracle') {
      const result = await checkOracleInstance(credentials, instanceId);
      status = result.status;
      publicIp = result.publicIp;
    } else if (provider === 'aws') {
      const result = await checkAWSInstance(credentials, instanceId);
      status = result.status;
      publicIp = result.publicIp;
    }

    onLog(`Instance status: ${status}`);

    if (status === 'RUNNING' && publicIp) {
      return { status, publicIp };
    }

    if (status === 'TERMINATED' || status === 'STOPPED') {
      throw new Error(`Instance ${status.toLowerCase()} unexpectedly`);
    }

    await new Promise(r => setTimeout(r, interval));
  }

  throw new Error('Timeout waiting for instance to start');
}

async function checkOracleInstance(creds, instanceId) {
  // Will be implemented in oracle.js
  return { status: 'UNKNOWN', publicIp: null };
}

async function checkAWSInstance(creds, instanceId) {
  // Will be implemented in aws.js
  return { status: 'UNKNOWN', publicIp: null };
}
