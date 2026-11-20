import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { computeSignature, verifySignature } from '../src/lib/webhook.js';

// Vektor yang sama dengan versi Node: HMAC-SHA256(body, 'whsec-test-vector').
const SECRET = 'whsec-test-vector';
const BODY = '{"id":"evt-1","buyer_trx_id":"MB-TEST-1","status":"success"}';
const KNOWN_HEX = 'f05964fb08ce73aa2d1830d7b25e16eb2a70db42a459ea3b8e16253e9eb442bc';

test('computeSignature (WebCrypto) cocok dengan vektor HMAC yang diketahui', async () => {
  assert.equal(await computeSignature(BODY, SECRET), KNOWN_HEX);
  // cross-check langsung ke node:crypto
  const direct = crypto.createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
  assert.equal(direct, KNOWN_HEX);
});

test('computeSignature menerima Uint8Array sama seperti string', async () => {
  const bytes = new TextEncoder().encode(BODY);
  assert.equal(await computeSignature(bytes, SECRET), KNOWN_HEX);
});

test('verifySignature menerima signature yang benar', async () => {
  assert.equal(await verifySignature(BODY, KNOWN_HEX, SECRET), true);
});

test('verifySignature menerima signature huruf besar + spasi (dinormalisasi)', async () => {
  assert.equal(await verifySignature(BODY, '  ' + KNOWN_HEX.toUpperCase() + ' ', SECRET), true);
});

test('verifySignature menolak body yang diubah (tampered)', async () => {
  const tampered = BODY.replace('success', 'failed');
  assert.equal(await verifySignature(tampered, KNOWN_HEX, SECRET), false);
});

test('verifySignature menolak secret yang salah', async () => {
  assert.equal(await verifySignature(BODY, KNOWN_HEX, 'secret-lain'), false);
});

test('verifySignature menolak signature kosong / secret kosong', async () => {
  assert.equal(await verifySignature(BODY, '', SECRET), false);
  assert.equal(await verifySignature(BODY, KNOWN_HEX, ''), false);
  assert.equal(await verifySignature(BODY, undefined, SECRET), false);
  assert.equal(await verifySignature(BODY, null, SECRET), false);
});

test('verifySignature menolak signature dengan panjang berbeda', async () => {
  assert.equal(await verifySignature(BODY, KNOWN_HEX.slice(0, 32), SECRET), false);
});
