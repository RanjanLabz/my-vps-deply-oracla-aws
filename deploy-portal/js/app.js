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
// Worker Deployment (generate terminal script)
// ============================================================
function deployWorker() {
  const accountId = document.getElementById('cf-account-id').value.trim();
  const apiToken = document.getElementById('cf-api-token').value.trim();
  const workerName = document.getElementById('cf-worker-name').value.trim() || 'flowkit-deploy';

  if (!accountId || !apiToken) {
    alert('Cloudflare Account ID and API Token are required');
    return;
  }

  // Generate PowerShell script
  const script = generateDeployScript(accountId, apiToken, workerName);
  const blob = new Blob([script], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'flowkit-deploy.ps1';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Show instructions
  document.getElementById('worker-script-area').hidden = false;
  document.getElementById('worker-instructions-only').hidden = false;
  document.getElementById('worker-script-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function generateDeployScript(accountId, apiToken, workerName) {
  return `# FlowKit Worker Deploy Script
# Run: powershell -ExecutionPolicy Bypass -File flowkit-deploy.ps1

$ACCOUNT_ID = "${accountId}"
$API_TOKEN = "${apiToken}"
$WORKER_NAME = "${workerName}"
$BUNDLE_URL = "https://raw.githubusercontent.com/RanjanLabz/my-vps-deply-oracla-aws/main/workers/dist/bundle.js"
$API = "https://api.cloudflare.com/client/v4"
$auth = "Bearer $API_TOKEN"

Write-Host ""
Write-Host "=== FlowKit Worker Deploy ===" -ForegroundColor Cyan
Write-Host ""

function cfApi($method, $url, $body) {
  $headers = @{ Authorization = $auth }
  $params = @{ Uri = $url; Headers = $headers; Method = $method; UseBasicParsing = $true }
  if ($body) {
    $headers["Content-Type"] = "application/json"
    $params.Body = $body
  }
  try {
    $r = Invoke-WebRequest @params
    return ($r.Content | ConvertFrom-Json)
  } catch {
    $ex = $_.Exception
    if ($ex.Response) {
      $sr = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
      $errBody = $sr.ReadToEnd()
      Write-Host "  API Error: $errBody" -ForegroundColor Red
    }
    return $null
  }
}

try {
  # Step 1: Fetch worker script
  Write-Host "[1/5] Fetching worker script..." -ForegroundColor Yellow
  $scriptContent = (Invoke-WebRequest -Uri $BUNDLE_URL -UseBasicParsing).Content
  Write-Host "  OK ($($scriptContent.Length) bytes)" -ForegroundColor Green

  # Step 2: Verify credentials
  Write-Host "[2/5] Verifying credentials..." -ForegroundColor Yellow
  $accts = cfApi "GET" "$API/accounts?page=1&per_page=5" $null
  if (-not $accts -or -not $accts.success) { throw "Invalid API token. Check your token has Workers Scripts:Edit and KV Storage:Edit." }
  Write-Host "  OK (Account: $($accts.result[0].name))" -ForegroundColor Green

  # Step 3: KV namespace (try create, skip if fails)
  Write-Host "[3/5] Setting up KV namespace..." -ForegroundColor Yellow
  $kvId = $null
  $kvResult = cfApi "POST" "$API/accounts/$ACCOUNT_ID/workers/kv/namespaces" (@{ title = "DEPLOY_JOBS" } | ConvertTo-Json)
  if ($kvResult -and $kvResult.success) {
    $kvId = $kvResult.result.id
    Write-Host "  Created: $kvId" -ForegroundColor Green
  } else {
    Write-Host "  KV failed (continuing without KV binding)" -ForegroundColor Yellow
  }

  # Step 4: Upload worker
  Write-Host "[4/5] Uploading worker..." -ForegroundColor Yellow
  if ($kvId) {
    $meta = @{ main_module = "index.js"; compatibility_date = "2024-01-01"; bindings = @(@{ type = "kv_namespace"; name = "DEPLOY_JOBS"; namespace_id = $kvId }) } | ConvertTo-Json -Depth 3
  } else {
    $meta = @{ main_module = "index.js"; compatibility_date = "2024-01-01" } | ConvertTo-Json -Depth 3
  }

  $tmpMeta = Join-Path $env:TEMP "flowkit_meta.json"
  $tmpJs = Join-Path $env:TEMP "flowkit_worker.js"
  [System.IO.File]::WriteAllText($tmpMeta, $meta, [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText($tmpJs, $scriptContent, [System.Text.Encoding]::UTF8)

  $url = "$API/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME"
  $headers = @{ Authorization = $auth }
  $form = @{ metadata = Get-Item $tmpMeta; "index.js" = Get-Item $tmpJs }
  try {
    $r = Invoke-WebRequest -Uri $url -Headers $headers -Method Put -Form $form -UseBasicParsing
    $d = $r.Content | ConvertFrom-Json
    if (-not $d.success) { throw "Upload failed" }
    Write-Host "  OK" -ForegroundColor Green
  } catch {
    $ex = $_.Exception
    if ($ex.Response) {
      $sr = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
      Write-Host "  Error: $($sr.ReadToEnd())" -ForegroundColor Red
    }
    throw "Worker upload failed"
  }

  Remove-Item $tmpMeta -ErrorAction SilentlyContinue
  Remove-Item $tmpJs -ErrorAction SilentlyContinue

  # Step 5: Get worker URL
  Write-Host "[5/5] Getting worker URL..." -ForegroundColor Yellow
  $workerUrl = "https://$WORKER_NAME.workers.dev"
  $subResult = cfApi "GET" "$API/accounts/$ACCOUNT_ID/workers/subdomain" $null
  if ($subResult -and $subResult.success -and $subResult.result.subdomain) {
    $workerUrl = "https://$WORKER_NAME.$($subResult.result.subdomain).workers.dev"
  }

  Write-Host "  Testing..." -ForegroundColor Yellow
  try {
    Invoke-WebRequest -Uri "$workerUrl/api/health" -UseBasicParsing | Out-Null
    Write-Host "  Healthy!" -ForegroundColor Green
  } catch {
    Write-Host "  Pending (wait a few seconds)" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "=== DONE ===" -ForegroundColor Green
  Write-Host ""
  Write-Host "Worker URL:" -ForegroundColor Cyan
  Write-Host "  $workerUrl" -ForegroundColor White -BackgroundColor DarkGreen
  Write-Host ""
  try { Set-Clipboard $workerUrl; Write-Host "Copied to clipboard!" -ForegroundColor Green } catch { }

} catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ""
}

Write-Host ""
Read-Host "Press Enter to exit"
`;
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
