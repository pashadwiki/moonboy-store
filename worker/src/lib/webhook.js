// X-H2H-Signature = hex HMAC-SHA256 dari RAW body, kunci = webhook_secret.
// Port dari versi Node (node:crypto sinkron) ke WebCrypto (asinkron):
// crypto.subtle.importKey + crypto.subtle.sign. Perbandingan dilakukan
// karakter-per-karakter dengan akumulasi XOR (constant-time untuk panjang
// yang sama), meniru timingSafeEqual versi Node. Signature dari header
// di-trim dan di-lowercase persis seperti versi Node.
const encoder = new TextEncoder();

function toBytes(rawBody) {
  if (typeof rawBody === 'string') return encoder.encode(rawBody);
  if (rawBody instanceof Uint8Array) return rawBody;
  return encoder.encode(String(rawBody));
}

function hexEncode(buf) {
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function computeSignature(rawBody, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, toBytes(rawBody));
  return hexEncode(sig);
}

export async function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = await computeSignature(rawBody, secret);
  const given = String(signature).trim().toLowerCase();
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}
