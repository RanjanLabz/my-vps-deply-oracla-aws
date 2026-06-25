/* Flow Kit — Deploy Portal App Logic */

// ============================================================
// Configuration
// ============================================================
const WORKER_URL = window.DEPLOY_CONFIG?.WORKER_URL || localStorage.getItem('flowkit_worker_url') || '';
let currentProvider = 'worker';

// Restore saved worker URL into config
if (WORKER_URL) {
  window.DEPLOY_CONFIG = window.DEPLOY_CONFIG || {};
  window.DEPLOY_CONFIG.WORKER_URL = WORKER_URL;
}

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
// Worker Deployment (generate deploy HTML)
// ============================================================
function deployWorker() {
  const accountId = document.getElementById('cf-account-id').value.trim();
  const apiToken = document.getElementById('cf-api-token').value.trim();
  const workerName = document.getElementById('cf-worker-name').value.trim() || 'flowkit-deploy';

  if (!accountId || !apiToken) {
    alert('Cloudflare Account ID and API Token are required');
    return;
  }

  // Generate and download deploy HTML file
  const html = generateDeployHTML(accountId, apiToken, workerName);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'flowkit-deploy.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Show instructions
  document.getElementById('worker-script-area').hidden = false;
  document.getElementById('worker-script-area').querySelector('.script-block').hidden = true;
  document.getElementById('worker-instructions-only').hidden = false;

  document.getElementById('worker-script-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function generateDeployHTML(accountId, apiToken, workerName) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>FlowKit Worker Deploy</title>
  <style>
    body { font-family: system-ui; background: #0a0a0f; color: #e8e8ed; padding: 2rem; max-width: 700px; margin: 0 auto; }
    h1 { color: #6366f1; font-size: 1.5rem; }
    .log { background: #12121a; border: 1px solid #2a2a3a; border-radius: 8px; padding: 1rem; margin: 1rem 0; font-family: monospace; font-size: 0.85rem; line-height: 1.8; max-height: 400px; overflow-y: auto; }
    .log .ok { color: #22c55e; } .log .err { color: #ef4444; } .log .info { color: #6366f1; }
    .url-box { background: #1a1a24; border: 2px solid #22c55e; border-radius: 8px; padding: 1rem; margin: 1rem 0; text-align: center; }
    .url-box code { font-size: 1.1rem; color: #22c55e; font-weight: bold; }
    .copy-btn { padding: 0.5rem 1.5rem; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9rem; margin-top: 0.5rem; }
    .copy-btn:hover { background: #818cf8; }
    #status { font-size: 1rem; margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>FlowKit — Deploy Cloudflare Worker</h1>
  <p>This page will deploy your FlowKit worker automatically.</p>
  <div id="status">Starting deployment...</div>
  <div class="log" id="log"></div>
  <div id="result-box" style="display:none">
    <div class="url-box">
      <div>Worker URL:</div>
      <code id="worker-url"></code><br>
      <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('worker-url').textContent);this.textContent='Copied!'">Copy URL</button>
    </div>
    <p>Paste this URL in the FlowKit deploy portal and click <strong>"Save URL"</strong>.</p>
  </div>
  <script>
    const ACCOUNT_ID = '${accountId}';
    const API_TOKEN = '${apiToken}';
    const WORKER_NAME = '${workerName}';
    const KV_NAME = 'DEPLOY_JOBS';
    const BUNDLE_URL = 'https://raw.githubusercontent.com/RanjanLabz/my-vps-deply-oracla-aws/main/workers/dist/bundle.js';
    const API = 'https://api.cloudflare.com/client/v4';

    function log(msg, cls) {
      const el = document.getElementById('log');
      el.innerHTML += '<div class="' + (cls||'info') + '">' + msg + '</div>';
      el.scrollTop = el.scrollHeight;
    }

    (async () => {
      try {
        log('Fetching worker script from GitHub...', 'info');
        let sr = await fetch(BUNDLE_URL);
        if (!sr.ok) throw new Error('Failed to fetch script (HTTP ' + sr.status + ')');
        let scriptContent = await sr.text();
        log('Script loaded (' + scriptContent.length + ' bytes)', 'ok');

        log('Verifying credentials...', 'info');
        let r = await fetch(API + '/accounts?page=1&per_page=5', { headers: { 'Authorization': 'Bearer ' + API_TOKEN, 'Content-Type': 'application/json' } });
        let d = await r.json();
        if (!d.success) throw new Error('Invalid API token: ' + (d.errors?.map(e=>e.message).join(', ')||'unknown'));
        log('Credentials verified', 'ok');

        log('Looking for KV namespace...', 'info');
        let kvId = null, page = 1;
        while (true) {
          r = await fetch(API + '/accounts/' + ACCOUNT_ID + '/workers/kv/namespaces?page=' + page + '&per_page=100', { headers: { 'Authorization': 'Bearer ' + API_TOKEN } });
          d = await r.json();
          if (!d.success) break;
          const found = d.result.find(ns => ns.title === KV_NAME);
          if (found) { kvId = found.id; break; }
          if (!d.result_info || page >= d.result_info.total_pages) break;
          page++;
        }

        if (!kvId) {
          log('Creating KV namespace...', 'info');
          r = await fetch(API + '/accounts/' + ACCOUNT_ID + '/workers/kv/namespaces', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + API_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: KV_NAME })
          });
          d = await r.json();
          if (!d.success) throw new Error('KV create failed: ' + d.errors?.map(e=>e.message).join(', '));
          kvId = d.result.id;
          log('KV created: ' + kvId, 'ok');
        } else {
          log('KV found: ' + kvId, 'ok');
        }

        log('Uploading worker script...', 'info');
        const metadata = {
          main_module: 'index.js', compatibility_date: '2024-01-01',
          bindings: [{ type: 'kv_namespace', name: 'DEPLOY_JOBS', namespace_id: kvId }]
        };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('index.js', new Blob([scriptContent], { type: 'application/javascript+module' }), 'index.js');

        r = await fetch(API + '/accounts/' + ACCOUNT_ID + '/workers/scripts/' + WORKER_NAME, {
          method: 'PUT', headers: { 'Authorization': 'Bearer ' + API_TOKEN }, body: form
        });
        d = await r.json();
        if (!d.success) throw new Error('Upload failed: ' + d.errors?.map(e=>e.message).join(', '));
        log('Worker uploaded!', 'ok');

        log('Getting worker URL...', 'info');
        r = await fetch(API + '/accounts/' + ACCOUNT_ID + '/workers/subdomain', { headers: { 'Authorization': 'Bearer ' + API_TOKEN } });
        d = await r.json();
        let workerUrl = 'https://' + WORKER_NAME + '.workers.dev';
        if (d.success && d.result?.subdomain) workerUrl = 'https://' + WORKER_NAME + '.' + d.result.subdomain + '.workers.dev';

        log('Testing worker health...', 'info');
        try {
          r = await fetch(workerUrl + '/api/health', { signal: AbortSignal.timeout(10000) });
          if (r.ok) log('Worker is healthy!', 'ok');
          else log('Health check returned ' + r.status, 'info');
        } catch(e) { log('Health check pending...', 'info'); }

        document.getElementById('status').innerHTML = '<span style="color:#22c55e;font-weight:bold">Deployment complete!</span>';
        document.getElementById('worker-url').textContent = workerUrl;
        document.getElementById('result-box').style.display = 'block';

      } catch (err) {
        document.getElementById('status').innerHTML = '<span style="color:#ef4444;font-weight:bold">ERROR: ' + err.message + '</span>';
        log('ERROR: ' + err.message, 'err');
      }
    })();
  <\/script>
</body>
</html>`;
}

function saveWorkerUrl() {
  const url = document.getElementById('worker-url-input').value.trim();
  if (!url) {
    alert('Paste the worker URL from the console output');
    return;
  }
  if (!url.includes('workers.dev')) {
    alert('Invalid worker URL. It should end with .workers.dev');
    return;
  }

  // Save to localStorage for persistence
  localStorage.setItem('flowkit_worker_url', url);

  // Update config.js reference
  window.DEPLOY_CONFIG = window.DEPLOY_CONFIG || {};
  window.DEPLOY_CONFIG.WORKER_URL = url;

  // Show success status
  document.getElementById('worker-status').hidden = false;
  document.getElementById('worker-url-text').textContent = url;

  alert('Worker URL saved! You can now use the Oracle Cloud or AWS tabs.');
}

// ============================================================
// Deploy Flow (via Cloudflare Worker)
// ============================================================
async function startDeploy(provider) {
  const credentials = getCredentials(provider);

  // Check worker URL is configured (check dynamically from config or localStorage)
  const workerUrl = window.DEPLOY_CONFIG?.WORKER_URL || localStorage.getItem('flowkit_worker_url') || '';
  if (!workerUrl) {
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
    const response = await fetch(`${workerUrl}/api/deploy`, {
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
