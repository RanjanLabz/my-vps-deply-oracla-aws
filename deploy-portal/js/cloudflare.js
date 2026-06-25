/*
 * Cloudflare API Helper — deploys worker via Cloudflare REST API
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

/**
 * Create KV namespace for deployment jobs
 */
async function createKVNamespace(accountId, apiToken, namespaceName) {
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/kv/namespaces`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: namespaceName }),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.map(e => e.message).join(', ') || 'Failed to create KV namespace');
  }
  return data.result.id;
}

/**
 * List existing KV namespaces to find one by name
 */
async function findKVNamespace(accountId, apiToken, namespaceName) {
  let page = 1;
  while (true) {
    const res = await fetch(`${CF_API}/accounts/${accountId}/workers/kv/namespaces?page=${page}&per_page=100`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });
    const data = await res.json();
    if (!data.success) break;

    const found = data.result.find(ns => ns.title === namespaceName);
    if (found) return found.id;

    if (!data.result_info || page >= data.result_info.total_pages) break;
    page++;
  }
  return null;
}

/**
 * Get or create KV namespace
 */
async function ensureKVNamespace(accountId, apiToken, namespaceName = 'DEPLOY_JOBS') {
  let nsId = await findKVNamespace(accountId, apiToken, namespaceName);
  if (!nsId) {
    nsId = await createKVNamespace(accountId, apiToken, namespaceName);
  }
  return nsId;
}

/**
 * Upload worker script with KV binding
 */
async function uploadWorker(accountId, apiToken, workerName, scriptContent, kvNamespaceId) {
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${workerName}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/javascript+module',
    },
    body: scriptContent,
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.map(e => e.message).join(', ') || 'Failed to upload worker');
  }
  return data.result;
}

/**
 * Create KV binding for the worker
 */
async function bindKVToWorker(accountId, apiToken, workerName, kvNamespaceId, bindingName = 'DEPLOY_JOBS') {
  // Upload worker with metadata including KV binding
  const metadata = {
    main_module: 'index.js',
    compatibility_date: new Date().toISOString().split('T')[0],
    bindings: [
      {
        type: 'kv_namespace',
        name: bindingName,
        namespace_id: kvNamespaceId,
      },
    ],
  };

  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${workerName}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'multipart/form-data',
    },
    body: (() => {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('index.js', new Blob([getWorkerScript()], { type: 'application/javascript+module' }), 'index.js');
      return form;
    })(),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.map(e => e.message).join(', ') || 'Failed to bind KV');
  }
  return data.result;
}

/**
 * Deploy worker with KV binding
 */
async function deployWorkerWithKV(accountId, apiToken, workerName, kvNamespaceId) {
  const metadata = {
    main_module: 'index.js',
    compatibility_date: '2024-01-01',
    bindings: [
      {
        type: 'kv_namespace',
        name: 'DEPLOY_JOBS',
        namespace_id: kvNamespaceId,
      },
    ],
  };

  const scriptContent = getWorkerScript();

  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${workerName}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
    body: (() => {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('index.js', new Blob([scriptContent], { type: 'application/javascript+module' }), 'index.js');
      return form;
    })(),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.map(e => e.message).join(', ') || 'Failed to deploy worker');
  }
  return data.result;
}

/**
 * Get worker subdomain and return full worker URL
 */
async function getWorkerUrl(accountId, apiToken, workerName) {
  // Get subdomain
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/subdomain`, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });
  const data = await res.json();

  if (!data.success || !data.result?.subdomain) {
    return `https://${workerName}.workers.dev`;
  }

  return `https://${workerName}.${data.result.subdomain}.workers.dev`;
}

/**
 * Full deployment flow: create KV, deploy worker, return URL
 */
async function deployFlowKitWorker(accountId, apiToken, workerName, onProgress) {
  onProgress('Verifying Cloudflare credentials...');

  // Verify credentials by fetching accounts
  const verifyRes = await fetch(`${CF_API}/accounts?page=1&per_page=5`, {
    headers: { 'Authorization': `Bearer ${apiToken}` },
  });
  const verifyData = await verifyRes.json();
  if (!verifyData.success) {
    throw new Error('Invalid Cloudflare API token');
  }

  onProgress('Ensuring KV namespace exists...');
  const kvId = await ensureKVNamespace(accountId, apiToken, 'DEPLOY_JOBS');
  onProgress(`KV namespace ready: ${kvId}`);

  onProgress('Deploying worker script...');
  await deployWorkerWithKV(accountId, apiToken, workerName, kvId);

  onProgress('Getting worker URL...');
  const workerUrl = await getWorkerUrl(accountId, apiToken, workerName);

  onProgress('Testing worker health...');
  try {
    const healthRes = await fetch(`${workerUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (healthRes.ok) {
      onProgress('Worker is healthy and ready!');
    }
  } catch (e) {
    onProgress('Worker deployed (health check pending — may take a few seconds)');
  }

  return { workerUrl, kvNamespaceId: kvId };
}

/**
 * Generate install command for existing VPS
 */
function generateInstallCommand(ip, user) {
  return `ssh -o StrictHostKeyChecking=no ${user}@${ip} 'curl -fsSL https://raw.githubusercontent.com/RanjanLabz/my-vps-deply-oracla-aws/main/oracle-cloud-setup.sh | bash'`;
}
