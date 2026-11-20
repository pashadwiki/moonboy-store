'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { computeSignature, verifySignature } = require('../lib/webhook');

// Vektor yang diketahui: HMAC-SHA256(body, 'whsec-test-vector') dihitung
// independen dengan node:crypto CLI sebelum test ini ditulis.
const SECRET = 'whsec-test-vector';
const BODY = '{"id":"evt-1","buyer_trx_id":"MB-TEST-1","status":"success"}';
const KNOWN_HEX = 'f05964fb08ce73aa2d1830d7b25e16eb2a70db42a459ea3b8e16253e9eb442bc';

test('computeSignature cocok dengan vektor HMAC yang diketahui', () => {
  assert.equal(computeSignature(Buffer.from(BODY, 'utf8'), SECRET), KNOWN_HEX);
  // cross-check langsung ke node:crypto
  const direct = crypto.createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
  assert.equal(direct, KNOWN_HEX);
});

test('verifySignature menerima signature yang benar', () => {
  assert.equal(verifySignature(Buffer.from(BODY, 'utf8'), KNOWN_HEX, SECRET), true);
});

test('verifySignature menolak body yang diubah (tampered)', () => {
  const tampered = BODY.replace('success', 'failed');
  assert.equal(verifySignature(Buffer.from(tampered, 'utf8'), KNOWN_HEX, SECRET), false);
});

test('verifySignature menolak secret yang salah', () => {
  assert.equal(verifySignature(Buffer.from(BODY, 'utf8'), KNOWN_HEX, 'secret-lain'), false);
});

test('verifySignature menolak signature kosong / secret kosong', () => {
  assert.equal(verifySignature(Buffer.from(BODY, 'utf8'), '', SECRET), false);
  assert.equal(verifySignature(Buffer.from(BODY, 'utf8'), KNOWN_HEX, ''), false);
  assert.equal(verifySignature(Buffer.from(BODY, 'utf8'), undefined, SECRET), false);
});

test('verifySignature menolak signature dengan panjang berbeda', () => {
  assert.equal(verifySignature(Buffer.from(BODY, 'utf8'), KNOWN_HEX.slice(0, 32), SECRET), false);
});
