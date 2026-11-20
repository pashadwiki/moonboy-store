'use strict';

const crypto = require('node:crypto');

// X-H2H-Signature = hex HMAC-SHA256 dari RAW body, kunci = webhook_secret.
function computeSignature(rawBody, secret) {
  return crypto.createHmac('sha256', String(secret)).update(rawBody).digest('hex');
}

function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = Buffer.from(computeSignature(rawBody, secret), 'utf8');
  const given = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

module.exports = { computeSignature, verifySignature };
