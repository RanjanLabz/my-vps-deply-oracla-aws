var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// src/security.js
function validateOracleCredentials(creds) {
  const errors = [];
  if (!creds.tenancy || !creds.tenancy.startsWith("ocid1.tenancy."))
    errors.push("Invalid Tenancy OCID");
  if (!creds.user || !creds.user.startsWith("ocid1.user."))
    errors.push("Invalid User OCID");
  if (!creds.privateKey || !creds.privateKey.includes("BEGIN"))
    errors.push("Invalid private key (must be PEM format)");
  if (!creds.fingerprint || !/^[0-9a-f]{2}(:[0-9a-f]{2}){15}$/i.test(creds.fingerprint))
    errors.push("Invalid fingerprint format");
  if (!creds.region || !/^[a-z]{2}-[a-z]+-\d$/.test(creds.region))
    errors.push("Invalid region");
  if (!creds.sshPublicKey || !creds.sshPublicKey.startsWith("ssh-"))
    errors.push("Invalid SSH public key");
  return errors;
}
function validateAWSCredentials(creds) {
  const errors = [];
  if (!creds.accessKeyId || !creds.accessKeyId.startsWith("AKIA"))
    errors.push("Invalid Access Key ID (must start with AKIA)");
  if (!creds.secretAccessKey || creds.secretAccessKey.length < 20)
    errors.push("Invalid Secret Access Key");
  if (!creds.region || !/^[a-z]{2}-[a-z]+-\d$/.test(creds.region))
    errors.push("Invalid region");
  if (!creds.sshPublicKey || !creds.sshPublicKey.startsWith("ssh-"))
    errors.push("Invalid SSH public key");
  return errors;
}
function validateExistingCredentials(creds) {
  const errors = [];
  if (!creds.ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(creds.ip))
    errors.push("Invalid IP address");
  if (!creds.user || creds.user.length === 0)
    errors.push("Username is required");
  if (!creds.sshPrivateKey || !creds.sshPrivateKey.includes("BEGIN"))
    errors.push("Invalid SSH private key");
  if (creds.port && (creds.port < 1 || creds.port > 65535))
    errors.push("Invalid SSH port");
  return errors;
}
function sanitizeLog(msg) {
  return String(msg).replace(/[\r\n]+/g, " ").substring(0, 500);
}
async function checkRateLimit(env, ip) {
  if (!env.DEPLOY_JOBS) {
    return { allowed: true, remaining: 99 };
  }
  const key = `rate:${ip}`;
  const now = Date.now();
  const windowMs = 36e5;
  const maxReqs = 5;
  const data = await env.DEPLOY_JOBS.get(key, { type: "json" });
  if (!data) {
    await env.DEPLOY_JOBS.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
      expirationTtl: 3600
    });
    return { allowed: true, remaining: maxReqs - 1 };
  }
  if (now > data.resetAt) {
    await env.DEPLOY_JOBS.put(key, JSON.stringify({ count: 1, resetAt: now + windowMs }), {
      expirationTtl: 3600
    });
    return { allowed: true, remaining: maxReqs - 1 };
  }
  if (data.count >= maxReqs) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((data.resetAt - now) / 1e3) };
  }
  data.count++;
  await env.DEPLOY_JOBS.put(key, JSON.stringify(data), { expirationTtl: 3600 });
  return { allowed: true, remaining: maxReqs - data.count };
}

// node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;

// node_modules/jose/dist/webapi/lib/base64.js
function encodeBase64(input) {
  if (Uint8Array.prototype.toBase64) {
    return input.toBase64();
  }
  const CHUNK_SIZE = 32768;
  const arr = [];
  for (let i = 0; i < input.length; i += CHUNK_SIZE) {
    arr.push(String.fromCharCode.apply(null, input.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(arr.join(""));
}
function decodeBase64(encoded) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(encoded);
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// node_modules/jose/dist/webapi/util/base64url.js
function encode(input) {
  let unencoded = input;
  if (typeof unencoded === "string") {
    unencoded = encoder.encode(unencoded);
  }
  if (Uint8Array.prototype.toBase64) {
    return unencoded.toBase64({ alphabet: "base64url", omitPadding: true });
  }
  return encodeBase64(unencoded).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// node_modules/jose/dist/webapi/lib/invalid_key_input.js
function message(msg, actual, ...types) {
  types = types.filter(Boolean);
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else if (types.length === 2) {
    msg += `one of type ${types[0]} or ${types[1]}.`;
  } else {
    msg += `of type ${types[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
var invalidKeyInput = (actual, ...types) => message("Key must be ", actual, ...types);

// node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
__publicField(JOSEError, "code", "ERR_JOSE_GENERIC");
var JOSENotSupported = class extends JOSEError {
  code = "ERR_JOSE_NOT_SUPPORTED";
};
__publicField(JOSENotSupported, "code", "ERR_JOSE_NOT_SUPPORTED");
var JWKSMultipleMatchingKeys = class extends JOSEError {
  [Symbol.asyncIterator];
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
__publicField(JWKSMultipleMatchingKeys, "code", "ERR_JWKS_MULTIPLE_MATCHING_KEYS");

// node_modules/jose/dist/webapi/lib/is_key_like.js
var isCryptoKey = (key) => {
  if (key?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key instanceof CryptoKey;
  } catch {
    return false;
  }
};
var isKeyObject = (key) => key?.[Symbol.toStringTag] === "KeyObject";

// node_modules/jose/dist/webapi/lib/asn1.js
var bytesEqual = (a, b) => {
  if (a.byteLength !== b.length)
    return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
};
var createASN1State = (data) => ({ data, pos: 0 });
var parseLength = (state) => {
  const first = state.data[state.pos++];
  if (first & 128) {
    const lengthOfLen = first & 127;
    let length = 0;
    for (let i = 0; i < lengthOfLen; i++) {
      length = length << 8 | state.data[state.pos++];
    }
    return length;
  }
  return first;
};
var expectTag = (state, expectedTag, errorMessage) => {
  if (state.data[state.pos++] !== expectedTag) {
    throw new Error(errorMessage);
  }
};
var getSubarray = (state, length) => {
  const result = state.data.subarray(state.pos, state.pos + length);
  state.pos += length;
  return result;
};
var parseAlgorithmOID = (state) => {
  expectTag(state, 6, "Expected algorithm OID");
  const oidLen = parseLength(state);
  return getSubarray(state, oidLen);
};
function parsePKCS8Header(state) {
  expectTag(state, 48, "Invalid PKCS#8 structure");
  parseLength(state);
  expectTag(state, 2, "Expected version field");
  const verLen = parseLength(state);
  state.pos += verLen;
  expectTag(state, 48, "Expected algorithm identifier");
  const algIdLen = parseLength(state);
  const algIdStart = state.pos;
  return { algIdStart, algIdLength: algIdLen };
}
var parseECAlgorithmIdentifier = (state) => {
  const algOid = parseAlgorithmOID(state);
  if (bytesEqual(algOid, [43, 101, 110])) {
    return "X25519";
  }
  if (!bytesEqual(algOid, [42, 134, 72, 206, 61, 2, 1])) {
    throw new Error("Unsupported key algorithm");
  }
  expectTag(state, 6, "Expected curve OID");
  const curveOidLen = parseLength(state);
  const curveOid = getSubarray(state, curveOidLen);
  for (const { name, oid } of [
    { name: "P-256", oid: [42, 134, 72, 206, 61, 3, 1, 7] },
    { name: "P-384", oid: [43, 129, 4, 0, 34] },
    { name: "P-521", oid: [43, 129, 4, 0, 35] }
  ]) {
    if (bytesEqual(curveOid, oid)) {
      return name;
    }
  }
  throw new Error("Unsupported named curve");
};
var genericImport = async (keyFormat, keyData, alg, options) => {
  let algorithm;
  let keyUsages;
  const isPublic = keyFormat === "spki";
  const getSigUsages = () => isPublic ? ["verify"] : ["sign"];
  const getEncUsages = () => isPublic ? ["encrypt", "wrapKey"] : ["decrypt", "unwrapKey"];
  switch (alg) {
    case "PS256":
    case "PS384":
    case "PS512":
      algorithm = { name: "RSA-PSS", hash: `SHA-${alg.slice(-3)}` };
      keyUsages = getSigUsages();
      break;
    case "RS256":
    case "RS384":
    case "RS512":
      algorithm = { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${alg.slice(-3)}` };
      keyUsages = getSigUsages();
      break;
    case "RSA-OAEP":
    case "RSA-OAEP-256":
    case "RSA-OAEP-384":
    case "RSA-OAEP-512":
      algorithm = {
        name: "RSA-OAEP",
        hash: `SHA-${parseInt(alg.slice(-3), 10) || 1}`
      };
      keyUsages = getEncUsages();
      break;
    case "ES256":
    case "ES384":
    case "ES512": {
      const curveMap = { ES256: "P-256", ES384: "P-384", ES512: "P-521" };
      algorithm = { name: "ECDSA", namedCurve: curveMap[alg] };
      keyUsages = getSigUsages();
      break;
    }
    case "ECDH-ES":
    case "ECDH-ES+A128KW":
    case "ECDH-ES+A192KW":
    case "ECDH-ES+A256KW": {
      try {
        const namedCurve = options.getNamedCurve(keyData);
        algorithm = namedCurve === "X25519" ? { name: "X25519" } : { name: "ECDH", namedCurve };
      } catch (cause) {
        throw new JOSENotSupported("Invalid or unsupported key format");
      }
      keyUsages = isPublic ? [] : ["deriveBits"];
      break;
    }
    case "Ed25519":
    case "EdDSA":
      algorithm = { name: "Ed25519" };
      keyUsages = getSigUsages();
      break;
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      algorithm = { name: alg };
      keyUsages = getSigUsages();
      break;
    default:
      throw new JOSENotSupported('Invalid or unsupported "alg" (Algorithm) value');
  }
  return crypto.subtle.importKey(keyFormat, keyData, algorithm, options?.extractable ?? (isPublic ? true : false), keyUsages);
};
var processPEMData = (pem, pattern) => {
  return decodeBase64(pem.replace(pattern, ""));
};
var fromPKCS8 = (pem, alg, options) => {
  const keyData = processPEMData(pem, /(?:-----(?:BEGIN|END) PRIVATE KEY-----|\s)/g);
  let opts = options;
  if (alg?.startsWith?.("ECDH-ES")) {
    opts ||= {};
    opts.getNamedCurve = (keyData2) => {
      const state = createASN1State(keyData2);
      parsePKCS8Header(state);
      return parseECAlgorithmIdentifier(state);
    };
  }
  return genericImport("pkcs8", keyData, alg, opts);
};

// node_modules/jose/dist/webapi/key/import.js
async function importPKCS8(pkcs8, alg, options) {
  if (typeof pkcs8 !== "string" || pkcs8.indexOf("-----BEGIN PRIVATE KEY-----") !== 0) {
    throw new TypeError('"pkcs8" must be PKCS#8 formatted string');
  }
  return fromPKCS8(pkcs8, alg, options);
}

// node_modules/jose/dist/webapi/lib/key_to_jwk.js
async function keyToJWK(key) {
  if (isKeyObject(key)) {
    if (key.type === "secret") {
      key = key.export();
    } else {
      return key.export({ format: "jwk" });
    }
  }
  if (key instanceof Uint8Array) {
    return {
      kty: "oct",
      k: encode(key)
    };
  }
  if (!isCryptoKey(key)) {
    throw new TypeError(invalidKeyInput(key, "CryptoKey", "KeyObject", "Uint8Array"));
  }
  if (!key.extractable) {
    throw new TypeError("non-extractable CryptoKey cannot be exported as a JWK");
  }
  const { ext, key_ops, alg, use, ...jwk } = await crypto.subtle.exportKey("jwk", key);
  if (jwk.kty === "AKP") {
    ;
    jwk.alg = alg;
  }
  return jwk;
}

// node_modules/jose/dist/webapi/key/export.js
async function exportJWK(key) {
  return keyToJWK(key);
}

// src/oracle.js
async function createOracleInstance(creds, onLog) {
  const { tenancy, user, privateKey, fingerprint, region, shape, image, ocpus, sshPublicKey, compartment } = creds;
  const compartmentId = compartment || tenancy;
  onLog("Authenticating with Oracle Cloud API...");
  const baseUrl = `https://iaas.${region}.oraclecloud.com`;
  const availabilityDomain = await getAvailabilityDomain(creds, baseUrl, onLog);
  onLog(`Using availability domain: ${availabilityDomain}`);
  const imageVersion = image || "Ubuntu 22.04";
  const imageId = await getUbuntuImageId(creds, baseUrl, imageVersion, onLog);
  onLog(`Using image: ${imageId}`);
  const networkInfo = await ensureNetwork(creds, baseUrl, compartmentId, onLog);
  const instanceBody = {
    displayName: "flowkit-deploy",
    compartmentId,
    shape,
    shapeConfig: shape.includes("Flex") ? { ocpus, memoryInGBs: ocpus * 6 } : void 0,
    sourceDetails: {
      sourceType: "image",
      imageId
    },
    createVnicDetails: {
      subnetId: networkInfo.subnetId,
      assignPublicIp: true,
      displayName: "flowkit-vnic"
    },
    metadata: {
      ssh_authorized_keys: sshPublicKey,
      user_data: btoa(generateOracleUserData())
    }
  };
  onLog("Creating compute instance...");
  const response = await ociFetch(creds, baseUrl, "POST", `/20160918/instances`, instanceBody);
  const instance = response;
  onLog(`Instance created: ${instance.id}`);
  onLog("Waiting for instance to start (this may take 2-3 minutes)...");
  const result = await waitForOracleInstance(creds, baseUrl, instance.id, onLog);
  onLog(`Instance is running at ${result.publicIp}`);
  onLog("Waiting for setup script to complete (this may take 3-5 minutes)...");
  await waitForFlowKitReady(result.publicIp, onLog);
  return result;
}
async function getAvailabilityDomain(creds, baseUrl, onLog) {
  try {
    const compartmentId = creds.compartment || creds.tenancy;
    const response = await ociFetch(
      creds,
      baseUrl,
      "GET",
      `/20160918/availabilityDomains?compartmentId=${compartmentId}`
    );
    return response[0].name;
  } catch (e) {
    onLog(`AD API failed (${e.message}), using default AD`);
    return "ffod:AP-SINGAPORE-1-AD-1";
  }
}
async function getUbuntuImageId(creds, baseUrl, imageVersion, onLog) {
  const osVersion = (imageVersion || "22.04").replace("Ubuntu ", "");
  const response = await ociFetch(
    creds,
    baseUrl,
    "GET",
    `/20160918/images?compartmentId=${creds.tenancy}&operatingSystem=Canonical Ubuntu&operatingSystemVersion=${osVersion}&sortBy=timeCreated&sortOrder=DESC`
  );
  if (!response || response.length === 0) {
    throw new Error(`No Ubuntu ${imageVersion} image found`);
  }
  return response[0].id;
}
async function ensureNetwork(creds, baseUrl, compartmentId, onLog) {
  onLog("Checking network configuration...");
  const vcns = await ociFetch(
    creds,
    baseUrl,
    "GET",
    `/20160918/vcns?compartmentId=${compartmentId}`
  );
  let vcnId, subnetId;
  if (vcns && vcns.length > 0) {
    vcnId = vcns[0].id;
    onLog(`Using existing VCN: ${vcnId}`);
    const subnets = await ociFetch(
      creds,
      baseUrl,
      "GET",
      `/20160918/subnets?compartmentId=${compartmentId}&vcnId=${vcnId}`
    );
    if (subnets && subnets.length > 0) {
      subnetId = subnets[0].id;
      onLog(`Using existing subnet: ${subnetId}`);
    }
  }
  if (!vcnId) {
    onLog("Creating VCN...");
    const vcn = await ociFetch(creds, baseUrl, "POST", "/20160918/vcns", {
      compartmentId,
      displayName: "flowkit-vcn",
      cidrBlock: "10.0.0.0/16"
    });
    vcnId = vcn.id;
    onLog(`VCN created: ${vcnId}`);
    const igw = await ociFetch(creds, baseUrl, "POST", "/20160918/internetgateways", {
      compartmentId,
      vcnId,
      displayName: "flowkit-igw",
      isEnabled: true
    });
    const rt = await ociFetch(creds, baseUrl, "POST", "/20160918/routetables", {
      compartmentId,
      vcnId,
      displayName: "flowkit-rt",
      routeRules: [{
        destination: "0.0.0.0/0",
        destinationType: "CIDR_BLOCK",
        networkEntityId: igw.id
      }]
    });
    const sl = await ociFetch(creds, baseUrl, "POST", "/20160918/securitylists", {
      compartmentId,
      vcnId,
      displayName: "flowkit-sl",
      ingressSecurityRules: [
        { protocol: "6", source: "0.0.0.0/0", tcpOptions: { destinationPortRange: { min: 22, max: 22 } } },
        { protocol: "6", source: "0.0.0.0/0", tcpOptions: { destinationPortRange: { min: 3e3, max: 3e3 } } },
        { protocol: "6", source: "0.0.0.0/0", tcpOptions: { destinationPortRange: { min: 8100, max: 8100 } } },
        { protocol: "6", source: "0.0.0.0/0", tcpOptions: { destinationPortRange: { min: 9222, max: 9222 } } },
        { protocol: "1", source: "0.0.0.0/0" }
        // ICMP
      ],
      egressSecurityRules: [
        { protocol: "all", destination: "0.0.0.0/0" }
      ]
    });
    const subnet = await ociFetch(creds, baseUrl, "POST", "/20160918/subnets", {
      compartmentId,
      vcnId,
      displayName: "flowkit-subnet",
      cidrBlock: "10.0.0.0/24",
      routeTableId: rt.id,
      securityListIds: [sl.id]
    });
    subnetId = subnet.id;
    onLog(`Subnet created: ${subnetId}`);
  }
  if (!subnetId) {
    const subnet = await ociFetch(creds, baseUrl, "POST", "/20160918/subnets", {
      compartmentId,
      vcnId,
      displayName: "flowkit-subnet",
      cidrBlock: "10.0.1.0/24"
    });
    subnetId = subnet.id;
  }
  return { vcnId, subnetId };
}
async function waitForOracleInstance(creds, baseUrl, instanceId, onLog) {
  const maxWait = 3e5;
  const interval = 1e4;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const instance = await ociFetch(creds, baseUrl, "GET", `/20160918/instances/${instanceId}`);
    onLog(`  Instance state: ${instance.lifecycleState}`);
    if (instance.lifecycleState === "RUNNING") {
      const vnics = await ociFetch(
        creds,
        baseUrl,
        "GET",
        `/20160918/vnicAttachments?instanceId=${instanceId}`
      );
      for (const vnic of vnics) {
        const vnicDetail = await ociFetch(creds, baseUrl, "GET", `/20160918/vnics/${vnic.vnicId}`);
        if (vnicDetail.publicIp) {
          return { instanceId, publicIp: vnicDetail.publicIp };
        }
      }
    }
    if (instance.lifecycleState === "TERMINATED" || instance.lifecycleState === "STOPPED") {
      throw new Error(`Instance ${instance.lifecycleState.toLowerCase()}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("Timeout waiting for Oracle instance");
}
async function waitForFlowKitReady(publicIp, onLog) {
  const maxWait = 6e5;
  const interval = 15e3;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`http://${publicIp}:8100/health`, {
        signal: AbortSignal.timeout(5e3)
      });
      if (response.ok) {
        onLog("Flow Kit backend is ready!");
        return;
      }
    } catch (e) {
    }
    onLog("  Waiting for Flow Kit services to start...");
    await new Promise((r) => setTimeout(r, interval));
  }
  onLog("Warning: Could not verify Flow Kit is ready. Instance is running.");
}
async function ociFetch(creds, baseUrl, method, path, body = null) {
  const url = `${baseUrl}${path}`;
  const now = (/* @__PURE__ */ new Date()).toUTCString();
  const headers = {
    "Host": new URL(url).host,
    "Date": now
  };
  if (method !== "GET" && body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = new TextEncoder().encode(JSON.stringify(body)).byteLength.toString();
  }
  const signature = await signOCIRequest(creds, method, path, headers);
  headers["Authorization"] = `Signature version="1",keyId="${creds.tenancy}/${creds.user}/${creds.fingerprint}",algorithm="rsa-sha256",headers="(request-target) host date",signature="${signature}"`;
  const options = {
    method,
    headers
  };
  if (body)
    options.body = JSON.stringify(body);
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OCI API error (${response.status}): ${error}`);
  }
  return response.json();
}
async function signOCIRequest(creds, method, path, headers) {
  const signingString = [
    `(request-target): ${method.toLowerCase()} ${path}`,
    `host: ${headers["Host"]}`,
    `date: ${headers["Date"]}`
  ].join("\n");
  const privateKey = await importPKCS8(creds.privateKey, "RS256", true);
  const jwk = await exportJWK(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const rawSig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingString)
  );
  const sigArray = new Uint8Array(rawSig);
  let binary = "";
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

// src/aws.js
var UBUNTU_AMIS = {
  "us-east-1": "ami-0c7217cdde317cfec",
  "us-east-2": "ami-0d5bf44967753de28",
  "us-west-1": "ami-0d2728e38c2795188",
  "us-west-2": "ami-03d6f58e1a0f6db7d",
  "eu-west-1": "ami-0d64bb532e0502c46",
  "eu-west-2": "ami-0ba3b6300b154bc0f",
  "eu-central-1": "ami-0d9884f4d1e045679",
  "ap-southeast-1": "ami-01b18e46e02e0e477",
  "ap-northeast-1": "ami-05775226b26593526",
  "ap-south-1": "ami-03d20aba8f41e7d06"
};
var UBUNTU_24_AMIS = {
  "us-east-1": "ami-084568db4383264d4",
  "us-east-2": "ami-0c916b67901d770f8",
  "us-west-1": "ami-0443305dabd4be2bc",
  "us-west-2": "ami-0892d3c7ee96c0bf7",
  "eu-west-1": "ami-0e416228a667e6eee",
  "eu-west-2": "ami-01b92b84b0f46d7c7",
  "eu-central-1": "ami-0989b29d37b30d392",
  "ap-southeast-1": "ami-0622e4856e44a76e5",
  "ap-northeast-1": "ami-04f7e431dd29a8378",
  "ap-south-1": "ami-0c332eb40b8b73564"
};
async function createAWSInstance(creds, onLog) {
  const { accessKeyId, secretAccessKey, region, instanceType, ami, sshPublicKey } = creds;
  onLog("Authenticating with AWS...");
  const ec2Endpoint = `https://ec2.${region}.amazonaws.com`;
  const amiId = ami === "ubuntu-24.04" ? UBUNTU_24_AMIS[region] || UBUNTU_24_AMIS["us-east-1"] : UBUNTU_AMIS[region] || UBUNTU_AMIS["us-east-1"];
  onLog(`Using AMI: ${amiId}`);
  onLog("Creating security group...");
  const sgId = await createSecurityGroup(creds, ec2Endpoint, onLog);
  const keyName = `flowkit-${Date.now()}`;
  onLog(`Creating key pair: ${keyName}`);
  await createKeyPair(creds, ec2Endpoint, keyName, sshPublicKey, onLog);
  onLog("Creating EC2 instance...");
  const userData = generateUserData();
  const params = {
    "Action": "RunInstances",
    "ImageId": amiId,
    "InstanceType": instanceType,
    "KeyName": keyName,
    "SecurityGroupId.1": sgId,
    "MinCount": "1",
    "MaxCount": "1",
    "UserData": btoa(userData),
    "TagSpecification.1.ResourceType": "instance",
    "TagSpecification.1.Tag.1.Key": "Name",
    "TagSpecification.1.Tag.1.Value": "flowkit-deploy"
  };
  const result = await awsEC2Fetch(creds, ec2Endpoint, params, onLog);
  const instanceId = result.instancesSet.item.instanceId;
  onLog(`Instance created: ${instanceId}`);
  onLog("Waiting for instance to start (this may take 1-2 minutes)...");
  const publicIp = await waitForAWSInstance(creds, ec2Endpoint, instanceId, onLog);
  onLog(`Instance is running at ${publicIp}`);
  onLog("Waiting for Flow Kit services to start (this may take 3-5 minutes)...");
  await waitForFlowKitReady2(publicIp, onLog);
  return { instanceId, publicIp };
}
async function createSecurityGroup(creds, endpoint, onLog) {
  const vpcResult = await awsEC2Fetch(creds, endpoint, {
    "Action": "DescribeVpcs",
    "Filter.1.Name": "isDefault",
    "Filter.1.Value.1": "true"
  }, onLog);
  const vpcId = vpcResult.vpcSet.item.vpcId;
  const sgResult = await awsEC2Fetch(creds, endpoint, {
    "Action": "CreateSecurityGroup",
    "GroupName": `flowkit-sg-${Date.now()}`,
    "Description": "Flow Kit deployment security group",
    "VpcId": vpcId
  }, onLog);
  const sgId = sgResult.groupId;
  const ports = [
    { port: 22, desc: "SSH" },
    { port: 3e3, desc: "Frontend" },
    { port: 8100, desc: "Backend API" },
    { port: 9222, desc: "WebSocket" }
  ];
  for (const { port } of ports) {
    await awsEC2Fetch(creds, endpoint, {
      "Action": "AuthorizeSecurityGroupIngress",
      "GroupId": sgId,
      "IpProtocol": "tcp",
      "FromPort": String(port),
      "ToPort": String(port),
      "CidrIp": "0.0.0.0/0"
    }, onLog);
  }
  onLog(`Security group created: ${sgId}`);
  return sgId;
}
async function createKeyPair(creds, endpoint, keyName, publicKey, onLog) {
  await awsEC2Fetch(creds, endpoint, {
    "Action": "ImportKeyPair",
    "KeyName": keyName,
    "PublicKeyMaterial": btoa(publicKey)
  }, onLog);
  onLog(`Key pair imported: ${keyName}`);
}
async function waitForAWSInstance(creds, endpoint, instanceId, onLog) {
  const maxWait = 18e4;
  const interval = 1e4;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const result = await awsEC2Fetch(creds, endpoint, {
      "Action": "DescribeInstances",
      "InstanceId.1": instanceId
    }, onLog);
    const reservation = result.reservationSet?.item;
    if (!reservation) {
      await new Promise((r) => setTimeout(r, interval));
      continue;
    }
    const instances = Array.isArray(reservation.instancesSet?.item) ? reservation.instancesSet.item : [reservation.instancesSet?.item].filter(Boolean);
    const instance = instances.find((i) => i.instanceId === instanceId);
    if (!instance) {
      await new Promise((r) => setTimeout(r, interval));
      continue;
    }
    onLog(`  Instance state: ${instance.instanceState.name}`);
    if (instance.instanceState.name === "running" && instance.ipAddress) {
      return instance.ipAddress;
    }
    if (instance.instanceState.name === "terminated" || instance.instanceState.name === "stopped") {
      throw new Error(`Instance ${instance.instanceState.name}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("Timeout waiting for AWS instance");
}
async function waitForFlowKitReady2(publicIp, onLog) {
  const maxWait = 6e5;
  const interval = 15e3;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(`http://${publicIp}:8100/health`, {
        signal: AbortSignal.timeout(5e3)
      });
      if (response.ok) {
        onLog("Flow Kit backend is ready!");
        return;
      }
    } catch (e) {
    }
    onLog("  Waiting for Flow Kit services to start...");
    await new Promise((r) => setTimeout(r, interval));
  }
  onLog("Warning: Could not verify Flow Kit is ready. Instance is running.");
}
async function awsEC2Fetch(creds, endpoint, params, onLog) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params).toString();
  const now = /* @__PURE__ */ new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const headers = {
    "Host": url.host,
    "X-Amz-Date": amzDate
  };
  const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k.toLowerCase()}:${headers[k]}`).join("\n") + "\n";
  const signedHeaders = Object.keys(headers).sort().map((k) => k.toLowerCase()).join(";");
  const canonicalRequest = [
    "GET",
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const credentialScope = `${dateStamp}/${creds.region}/ec2/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256(canonicalRequest)
  ].join("\n");
  const kDate = await hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, creds.region);
  const kService = await hmac(kRegion, "ec2");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = bufToHex(await hmac(kSigning, stringToSign, "hex"));
  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(url.toString(), { headers });
  const text = await response.text();
  const result = parseXmlResponse(text);
  if (result.error) {
    throw new Error(`AWS EC2 error: ${result.error.message}`);
  }
  return result;
}
async function sha256(message2) {
  const msgBuffer = new TextEncoder().encode(message2);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return bufToHex(hashBuffer);
}
async function hmac(key, data, encoding = "raw") {
  const cryptoKey = typeof key === "string" ? await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) : key;
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  if (encoding === "hex")
    return bufToHex(signature);
  return signature;
}
function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function parseXmlResponse(xml) {
  const result = {};
  const errorMatch = xml.match(/<Error>[\s\S]*?<Code>([\s\S]*?)<\/Code>[\s\S]*?<Message>([\s\S]*?)<\/Message>[\s\S]*?<\/Error>/);
  if (errorMatch) {
    result.error = { code: errorMatch[1], message: errorMatch[2] };
    return result;
  }
  const instanceMatch = xml.match(/<instancesSet>[\s\S]*?<item>[\s\S]*?<instanceId>([\s\S]*?)<\/instanceId>[\s\S]*?<instanceState>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/instanceState>[\s\S]*?<ipAddress>([\s\S]*?)<\/ipAddress>[\s\S]*?<\/item>[\s\S]*?<\/instancesSet>/);
  if (instanceMatch) {
    result.instancesSet = {
      item: {
        instanceId: instanceMatch[1],
        instanceState: { name: instanceMatch[2] },
        ipAddress: instanceMatch[3] || ""
      }
    };
  }
  const reservationMatch = xml.match(/<reservationSet>[\s\S]*?<item>[\s\S]*?<instancesSet>[\s\S]*?<item>[\s\S]*?<instanceId>([\s\S]*?)<\/instanceId>[\s\S]*?<instanceState>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/instanceState>[\s\S]*?<ipAddress>([\s\S]*?)<\/ipAddress>[\s\S]*?<\/item>[\s\S]*?<\/instancesSet>[\s\S]*?<\/item>[\s\S]*?<\/reservationSet>/);
  if (reservationMatch) {
    result.reservationSet = {
      item: {
        instancesSet: {
          item: {
            instanceId: reservationMatch[1],
            instanceState: { name: reservationMatch[2] },
            ipAddress: reservationMatch[3] || ""
          }
        }
      }
    };
  }
  const vpcMatch = xml.match(/<vpcSet>[\s\S]*?<item>[\s\S]*?<vpcId>([\s\S]*?)<\/vpcId>[\s\S]*?<\/item>[\s\S]*?<\/vpcSet>/);
  if (vpcMatch) {
    result.vpcSet = { item: { vpcId: vpcMatch[1] } };
  }
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

// src/ssh.js
function generateInstallCommand(ip, user, sshKey) {
  return `ssh -o StrictHostKeyChecking=no ${user}@${ip} 'curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/final-production/main/oracle-cloud-setup.sh | bash'`;
}

// src/index.js
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // Restrict to your domain in production
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var src_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse({ status: "ok", timestamp: Date.now() });
    }
    if (request.method === "POST" && url.pathname === "/api/deploy") {
      return handleDeploy(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/status/")) {
      const jobId = url.pathname.split("/").pop();
      return handleStatus(jobId, env);
    }
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }
};
async function handleDeploy(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ message: "Invalid JSON body" }, 400);
  }
  const { provider, credentials } = body;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rateLimit = await checkRateLimit(env, ip);
  if (!rateLimit.allowed) {
    return jsonResponse({
      message: `Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`
    }, 429);
  }
  let errors;
  switch (provider) {
    case "oracle":
      errors = validateOracleCredentials(credentials);
      break;
    case "aws":
      errors = validateAWSCredentials(credentials);
      break;
    case "existing":
      errors = validateExistingCredentials(credentials);
      break;
    default:
      return jsonResponse({ message: `Unknown provider: ${provider}` }, 400);
  }
  if (errors && errors.length > 0) {
    return jsonResponse({ message: errors.join(". ") }, 400);
  }
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder2 = new TextEncoder();
  const sendEvent = async (data) => {
    try {
      await writer.write(encoder2.encode(`data: ${JSON.stringify(data)}

`));
    } catch (e) {
    }
  };
  const onLog = (message2, level = "info") => {
    sendEvent({ type: "log", message: sanitizeLog(message2), level });
  };
  ctx.waitUntil(
    (async () => {
      try {
        let result;
        switch (provider) {
          case "oracle":
            sendEvent({ type: "log", message: "Starting Oracle Cloud deployment...", level: "step" });
            result = await createOracleInstance(credentials, onLog);
            break;
          case "aws":
            sendEvent({ type: "log", message: "Starting AWS deployment...", level: "step" });
            result = await createAWSInstance(credentials, onLog);
            break;
          case "existing":
            sendEvent({ type: "log", message: "Generating install command...", level: "step" });
            const command = generateInstallCommand(credentials.ip, credentials.user);
            sendEvent({ type: "log", message: `Run this command on your VPS:
${command}`, level: "warn" });
            sendEvent({
              type: "success",
              vpsIp: credentials.ip,
              authToken: "Run the command above to get your auth token"
            });
            break;
        }
        if (provider !== "existing") {
          const authToken = generateToken();
          sendEvent({
            type: "success",
            vpsIp: result.publicIp,
            instanceId: result.instanceId,
            authToken
          });
        }
      } catch (err) {
        sendEvent({ type: "error", message: err.message });
      } finally {
        await writer.close();
      }
    })()
  );
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...CORS_HEADERS
    }
  });
}
async function handleStatus(jobId, env) {
  const job = await env.DEPLOY_JOBS.get(`job:${jobId}`, { type: "json" });
  if (!job) {
    return jsonResponse({ message: "Job not found" }, 404);
  }
  return jsonResponse(job);
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
}
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export {
  src_default as default
};
