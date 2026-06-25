/* Flow Kit — Deploy Portal App Logic */

// ============================================================
// Configuration
// ============================================================
const WORKER_URL = window.DEPLOY_CONFIG?.WORKER_URL || '';
let currentProvider = 'oracle';

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
// Deploy Flow
// ============================================================
async function startDeploy(provider) {
  const credentials = getCredentials(provider);

  // Check worker URL is configured
  if (!WORKER_URL) {
    alert('Deployment backend not configured. The Cloudflare Worker URL needs to be set in config.js first.');
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
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          handleProgressEvent(data);
        }
      }
    }

    // Process remaining buffer
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
      appendLog(`[Step ${data.step}] ${data.message}`, 'step');
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

  // Update status badge
  const badge = document.getElementById('progress-status');
  badge.textContent = 'Complete';
  badge.className = 'status-badge success';
}

function showError(message) {
  hideAll();
  const el = document.getElementById('error');
  el.hidden = false;
  document.getElementById('error-message').textContent = message;

  const badge = document.getElementById('progress-status');
  if (badge) {
    badge.textContent = 'Failed';
    badge.className = 'status-badge error';
  }
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
  // Re-show the current form
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
