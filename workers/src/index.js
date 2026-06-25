/*
 * Cloudflare Worker — Flow Kit Deploy Portal Backend
 *
 * Routes:
 *   POST /api/deploy — Deploy Flow Kit to cloud
 *   GET  /api/status/:jobId — Check deployment status
 *   OPTIONS /* — CORS preflight
 */

import { validateOracleCredentials, validateAWSCredentials, validateExistingCredentials, checkRateLimit, sanitizeLog } from './security.js';
import { createOracleInstance } from './oracle.js';
import { createAWSInstance } from './aws.js';
import { generateUserData, generateInstallCommand } from './ssh.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // Restrict to your domain in production
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // POST /api/deploy
    if (request.method === 'POST' && url.pathname === '/api/deploy') {
      return handleDeploy(request, env, ctx);
    }

    // GET /api/status/:jobId
    if (request.method === 'GET' && url.pathname.startsWith('/api/status/')) {
      const jobId = url.pathname.split('/').pop();
      return handleStatus(jobId, env);
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  },
};

/**
 * Handle deployment request — streams progress via SSE.
 */
async function handleDeploy(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: 'Invalid JSON body' }, 400);
  }

  const { provider, credentials } = body;

  // Rate limiting
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rateLimit = await checkRateLimit(env, ip);
  if (!rateLimit.allowed) {
    return jsonResponse({
      message: `Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`,
    }, 429);
  }

  // Validate credentials
  let errors;
  switch (provider) {
    case 'oracle':
      errors = validateOracleCredentials(credentials);
      break;
    case 'aws':
      errors = validateAWSCredentials(credentials);
      break;
    case 'existing':
      errors = validateExistingCredentials(credentials);
      break;
    default:
      return jsonResponse({ message: `Unknown provider: ${provider}` }, 400);
  }

  if (errors && errors.length > 0) {
    return jsonResponse({ message: errors.join('. ') }, 400);
  }

  // Stream deployment progress via SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (data) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch (e) {
      // Client disconnected
    }
  };

  const onLog = (message, level = 'info') => {
    sendEvent({ type: 'log', message: sanitizeLog(message), level });
  };

  // Run deployment in background
  ctx.waitUntil(
    (async () => {
      try {
        let result;

        switch (provider) {
          case 'oracle':
            sendEvent({ type: 'log', message: 'Starting Oracle Cloud deployment...', level: 'step' });
            result = await createOracleInstance(credentials, onLog);
            break;

          case 'aws':
            sendEvent({ type: 'log', message: 'Starting AWS deployment...', level: 'step' });
            result = await createAWSInstance(credentials, onLog);
            break;

          case 'existing':
            sendEvent({ type: 'log', message: 'Generating install command...', level: 'step' });
            const command = generateInstallCommand(credentials.ip, credentials.user);
            sendEvent({ type: 'log', message: `Run this command on your VPS:\n${command}`, level: 'warn' });
            sendEvent({
              type: 'success',
              vpsIp: credentials.ip,
              authToken: 'Run the command above to get your auth token',
            });
            break;
        }

        if (provider !== 'existing') {
          // Generate auth token
          const authToken = generateToken();

          sendEvent({
            type: 'success',
            vpsIp: result.publicIp,
            instanceId: result.instanceId,
            authToken,
          });
        }
      } catch (err) {
        sendEvent({ type: 'error', message: err.message });
      } finally {
        await writer.close();
      }
    })()
  );

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Check deployment status (for polling).
 */
async function handleStatus(jobId, env) {
  const job = await env.DEPLOY_JOBS.get(`job:${jobId}`, { type: 'json' });
  if (!job) {
    return jsonResponse({ message: 'Job not found' }, 404);
  }
  return jsonResponse(job);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
