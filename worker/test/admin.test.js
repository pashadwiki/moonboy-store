// Admin: PIN-gated, pengaturan persisten di KV SETTINGS, menimpa env,
// kunci write-only (tidak pernah muncul di respons), markup baru langsung
// berlaku (cache dibersihkan), PIN bisa diganti.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStubMelo, makeEnv, callJson, jsonPost } from './mocks.js';

const stub = createStubMelo();
const env = makeEnv({ ADMIN_PIN: '999999' }); // kunci Melo BELUM ada di env

let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
});
after(() => {
  globalThis.fetch = realFetch;
});

const status = (pin) => callJson(env, '/api/admin/status', jsonPost({ pin }));
const config = (body) => callJson(env, '/api/admin/config', jsonPost(body));

test('admin: PIN salah ditolak di status dan config', async () => {
  const s = await status('000000');
  assert.equal(s.status, 403);
  const c = await config({ pin: '000000', markupPercent: '50' });
  assert.equal(c.status, 403);
});

test('admin: status awal — kunci belum terisi, toko belum aktif', async () => {
  const s = await status('999999');
  assert.equal(s.status, 200);
  assert.deepEqual(s.json.keysSet, { apiKey: false, secretKey: false, webhookSecret: false });
  assert.equal(s.json.active, false);
  assert.equal(s.json.sandbox, true);
  assert.equal(s.json.markupPercent, 12);
  assert.equal(s.json.rounding, 100);
});

test('admin: simpan kunci -> tersimpan di KV, aktif, nilai kunci tidak bocor', async () => {
  const res = await config({
    pin: '999999',
    apiKey: 'admin-api-key',
    secretKey: 'admin-secret-key',
    webhookSecret: 'whsec-admin',
    sandbox: true,
    markupPercent: '12',
    rounding: '100',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.keysSet, { apiKey: true, secretKey: true, webhookSecret: true });
  assert.equal(res.json.active, true);
  const raw = JSON.stringify(res.json);
  assert.equal(raw.includes('admin-api-key'), false, 'API key tidak boleh tampil di respons');
  assert.equal(raw.includes('admin-secret-key'), false);
  assert.equal(raw.includes('whsec-admin'), false);

  const blob = await env.SETTINGS.get('settings', { type: 'json' });
  assert.equal(blob.apiKey, 'admin-api-key', 'kunci harus persisten di KV SETTINGS');
  assert.equal(blob.secretKey, 'admin-secret-key');
  assert.equal(blob.webhookSecret, 'whsec-admin');
});

test('admin: kunci dari KV berlaku juga untuk isolate/env baru (persisten)', async () => {
  const env2 = makeEnv(); // env segar tanpa kunci, berbagi KV yang sama
  env2.SETTINGS = env.SETTINGS;
  env2.ORDERS = env.ORDERS;
  const brands = await callJson(env2, '/api/brands');
  assert.equal(brands.status, 200);
  assert.equal(brands.json.demo, false, 'kunci KV harus mengaktifkan toko di isolate baru');
});

test('admin: ubah markup -> harga berubah & kunci kosong tidak menimpa kunci lama', async () => {
  const res = await config({
    pin: '999999',
    apiKey: '', // kosong = biarkan
    secretKey: '',
    webhookSecret: '',
    sandbox: true,
    markupPercent: '50',
    rounding: '100',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.markupPercent, 50);
  assert.equal(res.json.active, true, 'kunci lama tidak boleh tertimpa string kosong');

  const products = await callJson(env, '/api/products?brand_id=10');
  assert.equal(products.status, 200);
  const p3 = products.json.products.find((p) => p.sku_code === 'MLID-S12');
  assert.equal(p3.sell_price, 1600, 'markup 50%: 1048 x 1.5 = 1572 -> 1600 (cache lama harus bersih)');
});

test('admin: matikan sandbox -> status mencerminkan & persisten di KV', async () => {
  const res = await config({
    pin: '999999', apiKey: '', secretKey: '', webhookSecret: '',
    sandbox: false, markupPercent: '50', rounding: '100',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.sandbox, false);
  const blob = await env.SETTINGS.get('settings', { type: 'json' });
  assert.equal(blob.sandbox, false);
});

test('admin: ganti PIN -> PIN lama ditolak, PIN baru diterima', async () => {
  const res = await config({
    pin: '999999', apiKey: '', secretKey: '', webhookSecret: '',
    sandbox: false, markupPercent: '50', rounding: '100', newPin: '777777',
  });
  assert.equal(res.status, 200);
  const oldPin = await status('999999');
  assert.equal(oldPin.status, 403, 'PIN lama (termasuk dari env) harus kalah oleh PIN di KV');
  const newPin = await status('777777');
  assert.equal(newPin.status, 200);
});

test('admin: body JSON rusak -> 400', async () => {
  const res = await callJson(env, '/api/admin/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bukan json',
  });
  assert.equal(res.status, 400);
});
