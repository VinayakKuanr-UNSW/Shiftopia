// Mint a short-lived Google OAuth2 access token for the FCM HTTP v1 API by
// signing a service-account JWT (RS256) with the Web Crypto API — no external
// dependencies. Scope is limited to firebase.messaging.

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

function base64UrlFromString(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlFromString(
    JSON.stringify({ iss: clientEmail, scope: FCM_SCOPE, aud: TOKEN_ENDPOINT, iat: now, exp: now + 3600 }),
  );
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

export async function getFcmAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  // Secrets stored via the dashboard often keep newlines escaped as \n.
  const normalizedKey = privateKeyPem.replace(/\\n/g, '\n');
  const assertion = await signJwt(clientEmail, normalizedKey);
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(payload)}`);
  }
  return payload.access_token as string;
}
