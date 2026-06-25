/* Security — Input validation and sanitization */

export function validateOracleCredentials(creds) {
  const errors = [];

  if (!creds.tenancy || !creds.tenancy.startsWith('ocid1.tenancy.'))
    errors.push('Invalid Tenancy OCID');
  if (!creds.user || !creds.user.startsWith('ocid1.user.'))
    errors.push('Invalid User OCID');
  if (!creds.privateKey || !creds.privateKey.includes('BEGIN'))
    errors.push('Invalid private key (must be PEM format)');
  if (!creds.fingerprint || !/^[0-9a-f]{2}(:[0-9a-f]{2}){15}$/i.test(creds.fingerprint))
    errors.push('Invalid fingerprint format');
  if (!creds.region || !/^[a-z]{2}-[a-z]+-\d$/.test(creds.region))
    errors.push('Invalid region');
  if (!creds.sshPublicKey || !creds.sshPublicKey.startsWith('ssh-'))
    errors.push('Invalid SSH public key');

  return errors;
}

export function validateAWSCredentials(creds) {
  const errors = [];

  if (!creds.accessKeyId || !creds.accessKeyId.startsWith('AKIA'))
    errors.push('Invalid Access Key ID (must start with AKIA)');
  if (!creds.secretAccessKey || creds.secretAccessKey.length < 20)
    errors.push('Invalid Secret Access Key');
  if (!creds.region || !/^[a-z]{2}-[a-z]+-\d$/.test(creds.region))
    errors.push('Invalid region');
  if (!creds.sshPublicKey || !creds.sshPublicKey.startsWith('ssh-'))
    errors.push('Invalid SSH public key');

  return errors;
}

export function validateExistingCredentials(creds) {
  const errors = [];

  if (!creds.ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(creds.ip))
    errors.push('Invalid IP address');
  if (!creds.user || creds.user.length === 0)
    errors.push('Username is required');
  if (!creds.sshPrivateKey || !creds.sshPrivateKey.includes('BEGIN'))
    errors.push('Invalid SSH private key');
  if (creds.port && (creds.port < 1 || creds.port > 65535))
    errors.push('Invalid SSH port');

  return errors;
}

// Sanitize log output to prevent injection
export function sanitizeLog(msg) {
  return String(msg).replace(/[\r\n]+/g, ' ').substring(0, 500);
}

// Rate limit check using KV
export async function checkRateLimit(env, ip) {
  if (!env.DEPLOY_JOBS) {
    return { allowed: true, remaining: 99 };
  }
  const key = `rate:${ip}`;
  const now = Date.now();
  const windowMs = 3600000; // 1 hour
  const maxReqs = 5;

  const data = await env.DEPLOY_JOBS.get(key, { type: 'json' });
  if (!data) {
    await env.DEPLOY_JOBS.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
      expirationTtl: 3600,
    });
    return { allowed: true, remaining: maxReqs - 1 };
  }

  if (now > data.resetAt) {
    await env.DEPLOY_JOBS.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
      expirationTtl: 3600,
    });
    return { allowed: true, remaining: maxReqs - 1 };
  }

  if (data.count >= maxReqs) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((data.resetAt - now) / 1000) };
  }

  data.count++;
  await env.DEPLOY_JOBS.put(key, JSON.stringify(data), { expirationTtl: 3600 });
  return { allowed: true, remaining: maxReqs - data.count };
}
