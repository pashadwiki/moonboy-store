// E2E Worker melawan stub API Melo (global fetch diganti stub in-process).
// Alur: brands (ter-cache) -> products 2 halaman -> cek nickname GET & POST
// -> buat pesanan -> webhook signature salah (401) -> action_change tidak
// menyelesaikan pesanan -> webhook benar -> status success -> webhook
// duplikat ter-dedupe -> halaman statis dari ASSETS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createStubMelo, makeEnv, call, callJson, jsonPost, WEBHOOK_SECRET,
} from './mocks.js';

const stub = createStubMelo();
const env = makeEnv({
  MELO_API_KEY: 'test-api-key',
  MELO_SECRET_KEY: 'test-secret-key',
  MELO_WEBHOOK_SECRET: WEBHOOK_SECRET,
  ADMIN_PIN: '999999',
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

function sign(raw) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');
}

test('e2e: brands dari stub Melo, panggilan kedua dari cache', async () => {
  const first = await callJson(env, '/api/brands');
  assert.equal(first.status, 200);
  assert.equal(first.json.demo, false);
  assert.equal(first.json.brands.length, 1);
  assert.equal(first.json.brands[0].brand_id, 10);
  assert.equal(first.json.brands[0].name, 'Mobile Legends (ID)');
  assert.equal(stub.state.counts.brands, 1);

  const second = await callJson(env, '/api/brands');
  assert.equal(second.status, 200);
  assert.deepEqual(second.json, first.json);
  assert.equal(stub.state.counts.brands, 1, 'brands kedua harus dari cache, bukan Melo lagi');
});

test('e2e: products menggabungkan 2 halaman, hanya yang active, harga jual terhitung, modal tidak bocor', async () => {
  const { status, json } = await callJson(env, '/api/products?brand_id=10');
  assert.equal(status, 200);
  assert.equal(json.demo, false);
  assert.equal(json.brand.name, 'Mobile Legends (ID)');
  assert.equal(json.products.length, 2, 'produk out_of_stock harus disaring');
  assert.equal(stub.state.counts.pricelists, 2, 'dua halaman cursor harus diambil');
  const p3 = json.products.find((p) => p.sku_code === 'MLID-S12');
  assert.equal(p3.sell_price, 1200, 'cost 1048 + markup 12% rounding 100 = 1200');
  assert.equal('price' in p3, false, 'harga modal Melo tidak boleh bocor ke browser');
  assert.equal('cost' in p3, false);
  assert.equal(p3.form.fields.length, 2);
  assert.equal(p3.form.fields[0].key, 'customer_target');
  assert.equal(p3.form.notice, 'Masukkan ID dan zone sesuai akun pembeli.');
  const p86 = json.products.find((p) => p.sku_code === 'MLID-S86');
  assert.equal(p86.sell_price, 19600, 'regresi float: 17500 x 1.12 harus 19600, bukan 19700');

  const again = await callJson(env, '/api/products?brand_id=10');
  assert.equal(again.status, 200);
  assert.equal(stub.state.counts.pricelists, 2, 'products kedua harus dari cache');
});

test('e2e: nickname-games dari stub Melo', async () => {
  const { status, json } = await callJson(env, '/api/nickname-games');
  assert.equal(status, 200);
  assert.equal(json.games.length, 1);
  assert.equal(json.games[0].game_code, 'mobile-legends');
  assert.equal(json.games[0].zone_required, true);
});

test('e2e: check-nickname GET ketemu dan tidak ketemu', async () => {
  const ok = await callJson(env, '/api/check-nickname?game_code=mobile-legends&target=12345678&zone=1234');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.found, true);
  assert.equal(ok.json.username, 'BosMoli');

  const no = await callJson(env, '/api/check-nickname?game_code=mobile-legends&target=00000000&zone=1234');
  assert.equal(no.status, 200);
  assert.equal(no.json.found, false);
});

test('e2e: check-nickname POST ketemu (bentuk body JSON)', async () => {
  const ok = await callJson(env, '/api/check-nickname', jsonPost({
    game_code: 'mobile-legends', target: '12345678', zone: '1234',
  }));
  assert.equal(ok.status, 200);
  assert.equal(ok.json.found, true);
  assert.equal(ok.json.username, 'BosMoli');

  const missing = await callJson(env, '/api/check-nickname', jsonPost({ game_code: 'mobile-legends' }));
  assert.equal(missing.status, 400);
});

let trxId;
const FINAL_PAYLOAD = (id) => ({
  id: '11111111-1111-4111-8111-111111111111',
  buyer_trx_id: id,
  sku_code: 'MLID-S12',
  customer_target: '12345678',
  customer_target_zone: '1234',
  status: 'success',
  serial_number: 'SN-0001',
  is_sandbox: true,
  price_charged: 1048,
  created_at: '2026-11-20T08:00:00+00:00',
  updated_at: '2026-11-20T08:01:00+00:00',
});

test('e2e: alur pesanan lengkap — buat, processing, webhook, status akhir success', async () => {
  const created = await callJson(env, '/api/order', jsonPost({
    sku_code: 'MLID-S12', customer_target: '12345678', customer_target_zone: '1234',
  }));
  assert.equal(created.status, 201);
  trxId = created.json.buyer_trx_id;
  assert.match(trxId, /^MB-/);
  assert.equal(created.json.status, 'processing');
  assert.equal(created.json.sell_price, 1200);
  // Kunci dikirim server-side ke Melo, tidak pernah lewat browser.
  assert.equal(stub.state.lastCreateHeaders['X-API-Key'], 'test-api-key');
  assert.equal(stub.state.lastCreateHeaders['X-Secret-Key'], 'test-secret-key');
  assert.equal(stub.state.createBodies.at(-1).sandbox_mode, true);

  const before2 = await callJson(env, '/api/order/' + encodeURIComponent(trxId));
  assert.equal(before2.status, 200);
  assert.equal(before2.json.status, 'processing');

  // Webhook signature SALAH -> 401, status tidak berubah.
  const payload = FINAL_PAYLOAD(trxId);
  const raw = JSON.stringify(payload);
  const bad = await call(env, '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': 'deadbeef' },
    body: raw,
  });
  assert.equal(bad.status, 401);
  const afterBad = await callJson(env, '/api/order/' + encodeURIComponent(trxId));
  assert.equal(afterBad.json.status, 'processing', 'webhook invalid tidak boleh mengubah pesanan');

  // Event action_change (bertanda tangan benar) dicatat tapi TIDAK
  // menyelesaikan pesanan.
  const actionPayload = {
    id: payload.id,
    buyer_trx_id: trxId,
    event: 'transaction.action_change',
    status: 'processing',
  };
  const actionRaw = JSON.stringify(actionPayload);
  const actionRes = await call(env, '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': sign(actionRaw) },
    body: actionRaw,
  });
  assert.equal(actionRes.status, 200);
  const stored = await env.ORDERS.get(trxId, { type: 'json' });
  assert.equal(stored.status, 'processing', 'action_change tidak boleh menyelesaikan pesanan');
  assert.equal(stored.action_events.length, 1);
  assert.equal(stored.action_events[0].event, 'transaction.action_change');

  // Webhook hasil akhir dengan signature BENAR.
  const good = await call(env, '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': sign(raw) },
    body: raw,
  });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { received: true });

  const final = await callJson(env, '/api/order/' + encodeURIComponent(trxId));
  assert.equal(final.json.status, 'success');
  assert.equal(final.json.serial_number, 'SN-0001');

  // Pengiriman ulang webhook yang sama = duplikat.
  const dup = await call(env, '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': sign(raw) },
    body: raw,
  });
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).duplicate, true);
  const storedFinal = await env.ORDERS.get(trxId, { type: 'json' });
  assert.equal(storedFinal.events.length, 1, 'event duplikat tidak boleh tercatat dua kali');
});

test('e2e: webhook dicocokkan lewat id Melo bila buyer_trx_id asing (fallback by-melo)', async () => {
  // buyer_trx_id diganti acak, tetapi id Melo milik pesanan yang sudah
  // success -> ditemukan lewat indeks by-melo dan ter-dedupe.
  const payload = { ...FINAL_PAYLOAD('MB-ACAK-TIDAK-DIKENAL'), id: '11111111-1111-4111-8111-111111111111' };
  const raw = JSON.stringify(payload);
  const res = await call(env, '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': sign(raw) },
    body: raw,
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).duplicate, true);
});

test('e2e: webhook untuk pesanan tak dikenal -> received, matched false', async () => {
  // buyer_trx_id DAN id Melo sama-sama tidak dikenal (bila id dikenal,
  // pesanan memang ditemukan lewat indeks by-melo — perilaku versi Node).
  const payload = { ...FINAL_PAYLOAD('MB-TIDAK-ADA-123'), id: '99999999-9999-4999-8999-999999999999' };
  const raw = JSON.stringify(payload);
  const res = await call(env, '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': sign(raw) },
    body: raw,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true, matched: false });
});

test('e2e: webhook tanpa webhook secret terkonfigurasi ditolak 401', async () => {
  const envNoSecret = makeEnv({ MELO_API_KEY: 'k', MELO_SECRET_KEY: 's' });
  const raw = JSON.stringify(FINAL_PAYLOAD('MB-X-1'));
  const res = await call(envNoSecret, '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': sign(raw) },
    body: raw,
  });
  assert.equal(res.status, 401);
});

test('e2e: pesanan tidak ditemukan -> 404; endpoint api tak dikenal -> 404', async () => {
  const notFound = await callJson(env, '/api/order/MB-NOPE-404');
  assert.equal(notFound.status, 404);
  const unknown = await callJson(env, '/api/ngawur');
  assert.equal(unknown.status, 404);
});

test('e2e: halaman statis terlayani dari ASSETS', async () => {
  const home = await call(env, '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /MoonBoy Store/);

  const admin = await call(env, '/admin');
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Admin Toko/);

  const adminHtml = await call(env, '/admin.html');
  assert.equal(adminHtml.status, 200);

  const brand = await call(env, '/brand.html');
  assert.equal(brand.status, 200);
  assert.match(await brand.text(), /Pilih Nominal/);

  const css = await call(env, '/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('Content-Type'), /text\/css/);
});
