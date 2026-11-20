// Mode demo: tanpa kunci Melo sama sekali. Katalog contoh tampil,
// pesanan & cek nickname menjawab 503 berbahasa Indonesia.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createStubMelo, makeEnv, callJson, jsonPost } from './mocks.js';

const stub = createStubMelo();
const env = makeEnv(); // tanpa MELO_API_KEY / MELO_SECRET_KEY

let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = stub.fetchImpl;
});
after(() => {
  globalThis.fetch = realFetch;
});

test('demo: brands adalah katalog demo', async () => {
  const { status, json } = await callJson(env, '/api/brands');
  assert.equal(status, 200);
  assert.equal(json.demo, true);
  assert.equal(json.brands.length, 2);
  assert.equal(json.brands[0].brand_id, 'demo-mlbb');
  assert.equal(json.brands[1].brand_id, 'demo-ff');
  assert.equal(stub.state.counts.brands, 0, 'mode demo tidak boleh menghubungi Melo');
});

test('demo: products MLBB dengan harga jual contoh yang benar', async () => {
  const { status, json } = await callJson(env, '/api/products?brand_id=demo-mlbb');
  assert.equal(status, 200);
  assert.equal(json.demo, true);
  assert.equal(json.brand.name, 'Mobile Legends');
  const prices = Object.fromEntries(json.products.map((p) => [p.sku_code, p.sell_price]));
  assert.deepEqual(prices, {
    'DEMO-MLBB-3': 1200, // 1048 x 1.12 -> 1200
    'DEMO-MLBB-5': 1800, // 1597 -> 1800
    'DEMO-MLBB-86': 19600, // 17500 -> 19600 (regresi float)
    'DEMO-MLBB-172': 39100, // 34900 -> 39100
    'DEMO-MLBB-WDP': 27500, // 24500 -> 27500
  });
  const p3 = json.products.find((p) => p.sku_code === 'DEMO-MLBB-3');
  assert.equal(p3.form.fields.length, 2);
  assert.equal('cost' in p3, false, 'harga modal contoh tidak ditampilkan sebagai field cost');
});

test('demo: products FF', async () => {
  const { status, json } = await callJson(env, '/api/products?brand_id=demo-ff');
  assert.equal(status, 200);
  const prices = Object.fromEntries(json.products.map((p) => [p.sku_code, p.sell_price]));
  assert.deepEqual(prices, {
    'DEMO-FF-5': 1100,
    'DEMO-FF-50': 7100,
    'DEMO-FF-70': 9900,
    'DEMO-FF-140': 19800,
  });
});

test('demo: brand tak dikenal -> 404; brand_id kosong -> 400', async () => {
  const notFound = await callJson(env, '/api/products?brand_id=demo-xxx');
  assert.equal(notFound.status, 404);
  const bad = await callJson(env, '/api/products');
  assert.equal(bad.status, 400);
});

test('demo: buat pesanan -> 503 toko belum aktif', async () => {
  const res = await callJson(env, '/api/order', jsonPost({
    sku_code: 'DEMO-MLBB-3', customer_target: '12345678', customer_target_zone: '1234',
  }));
  assert.equal(res.status, 503);
  assert.match(res.json.error, /Toko belum aktif/);
  assert.equal(stub.state.counts.create, 0, 'mode demo tidak boleh membuat transaksi');
});

test('demo: cek nickname GET & POST -> 503', async () => {
  const get = await callJson(env, '/api/check-nickname?game_code=mobile-legends&target=12345678');
  assert.equal(get.status, 503);
  const post = await callJson(env, '/api/check-nickname', jsonPost({
    game_code: 'mobile-legends', target: '12345678',
  }));
  assert.equal(post.status, 503);
});

test('demo: pesanan tidak valid -> 400 sebelum cek kunci', async () => {
  const res = await callJson(env, '/api/order', jsonPost({ sku_code: 'DEMO-MLBB-3' }));
  assert.equal(res.status, 400);
});
