// Retry create transaksi: timeout/5xx diulang SATU kali dengan
// buyer_trx_id yang SAMA persis (sesuai dokumentasi Melo). Bila tetap
// gagal, API menjawab 202 dan pesanan tersimpan berstatus 'created'
// untuk dipastikan kemudian lewat GET /transaction.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStubMelo, makeEnv, callJson, jsonPost } from './mocks.js';

const stub = createStubMelo();
const env = makeEnv({
  MELO_API_KEY: 'test-api-key',
  MELO_SECRET_KEY: 'test-secret-key',
  MELO_WEBHOOK_SECRET: 'whsec-retry',
  SANDBOX: 'true',
});

let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
});
after(() => {
  globalThis.fetch = realFetch;
});

test('retry: create pertama 500, kedua berhasil dengan buyer_trx_id yang sama', async () => {
  stub.state.failNextCreates = 1;
  const beforeCount = stub.state.counts.create;
  const created = await callJson(env, '/api/order', jsonPost({
    sku_code: 'MLID-S12', customer_target: '12345678', customer_target_zone: '1234',
  }));
  assert.equal(created.status, 201);
  assert.equal(created.json.status, 'processing');
  assert.equal(created.json.sell_price, 1200, 'harga jual dihitung dari price respons create');
  assert.equal(stub.state.counts.create, beforeCount + 2, 'harus ada tepat 2 percobaan create');
  const bodies = stub.state.createBodies.slice(-2);
  assert.equal(bodies[0].buyer_trx_id, bodies[1].buyer_trx_id, 'retry wajib memakai buyer_trx_id yang sama');
  assert.equal(bodies[0].buyer_trx_id, created.json.buyer_trx_id);
});

test('retry: semua percobaan 500 -> jawaban 202, pesanan tersimpan sebagai created', async () => {
  stub.state.failNextCreates = 99;
  const beforeCount = stub.state.counts.create;
  const res = await callJson(env, '/api/order', jsonPost({
    sku_code: 'MLID-S12', customer_target: '12345678', customer_target_zone: '1234',
  }));
  assert.equal(res.status, 202);
  assert.ok(res.json.buyer_trx_id, 'buyer_trx_id tetap diberikan');
  assert.equal(stub.state.counts.create, beforeCount + 2, 'maksimal 2 percobaan, tidak mengulang tanpa batas');
  const stored = await env.ORDERS.get(res.json.buyer_trx_id, { type: 'json' });
  assert.ok(stored, 'pesanan harus tersimpan di KV');
  assert.equal(stored.status, 'created');
  stub.state.failNextCreates = 0;
});

test('create ditolak 4xx oleh Melo -> pesanan failed, tanpa retry', async () => {
  // Pakai stub fetch khusus yang selalu menjawab 422 untuk create.
  const realImpl = stub.fetchImpl;
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/api/v1/h2h/transaction' && (init.method || 'GET') === 'POST') {
      stub.state.counts.create++;
      stub.state.createBodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ success: false, message: 'SKU tidak aktif.' }), {
        status: 422, headers: { 'Content-Type': 'application/json' },
      });
    }
    return realImpl(url, init);
  };
  try {
    const beforeCount = stub.state.counts.create;
    const res = await callJson(env, '/api/order', jsonPost({
      sku_code: 'MLID-DEAD', customer_target: '12345678',
    }));
    assert.equal(res.status, 422);
    assert.equal(res.json.error, 'SKU tidak aktif.');
    assert.equal(stub.state.counts.create, beforeCount + 1, '4xx tidak boleh di-retry');
    const stored = await env.ORDERS.get(res.json.buyer_trx_id, { type: 'json' });
    assert.equal(stored.status, 'failed');
    assert.equal(stored.error_message, 'SKU tidak aktif.');
  } finally {
    globalThis.fetch = realImpl;
  }
});
