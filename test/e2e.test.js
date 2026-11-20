'use strict';

// E2E: server MoonBoy Store melawan stub server Melo lokal.
// Stub meniru bentuk respons dokumentasi Melo: categories, pricelists
// (2 halaman, cursor pagination), transaction create 201 processing,
// transaction status, check-nickname. Setelah itu webhook bertanda tangan
// yang benar dikirim ke /webhook dan status pesanan harus jadi success.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const WEBHOOK_SECRET = 'whsec-e2e';

function createStubMelo() {
  const state = { transactions: new Map() };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stub');
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const readBody = (cb) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => cb(Buffer.concat(chunks).toString('utf8')));
    };

    if (req.method === 'GET' && url.pathname === '/api/v1/h2h/pricelists/categories') {
      return send(200, {
        success: true,
        data: [
          {
            brand_id: 10,
            name: 'Mobile Legends (ID)',
            slug: 'mobile-legends-id',
            category: { id: 1, name: 'Games', slug: 'games' },
            type: [{ id: 11, name: 'Diamonds', slug: 'diamonds' }],
          },
        ],
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/h2h/pricelists') {
      const form = {
        fields: [
          { key: 'customer_target', name: 'User ID', type: 'text' },
          { key: 'customer_target_zone', name: 'Zone ID', type: 'text' },
        ],
        notice: { id: 'Masukkan ID dan zone sesuai akun pembeli.', en: 'Enter the ID and zone.' },
      };
      const brands = [{ id: 10, name: 'Mobile Legends (ID)', thumbnail: null, order: 1 }];
      if (!url.searchParams.get('cursor')) {
        return send(200, {
          success: true,
          data: [
            {
              name: '3 Diamonds', sku_code: 'MLID-S12', price: 1048, brand_id: 10,
              type_name: 'Diamonds', server_code: 'global', status: 'active',
              inquiry_form_key: 'mlbb-form', id: 1,
            },
            {
              name: 'Produk Mati', sku_code: 'MLID-DEAD', price: 500, brand_id: 10,
              type_name: 'Diamonds', server_code: 'global', status: 'out_of_stock',
              inquiry_form_key: 'mlbb-form', id: 2,
            },
          ],
          meta: {
            brands, inquiry_forms: { 'mlbb-form': form },
            pagination: { cursor: null, next_cursor: 'page2', limit: 500, total: 3, has_more: true },
          },
        });
      }
      return send(200, {
        success: true,
        data: [
          {
            name: '86 Diamonds', sku_code: 'MLID-S86', price: 17500, brand_id: 10,
            type_name: 'Diamonds', server_code: 'global', status: 'active',
            inquiry_form_key: 'mlbb-form', id: 3,
          },
        ],
        meta: {
          brands, inquiry_forms: { 'mlbb-form': form },
          pagination: { cursor: 'page2', next_cursor: null, limit: 500, total: 3, has_more: false },
        },
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/h2h/transaction') {
      return readBody((raw) => {
        const body = JSON.parse(raw);
        const id = '11111111-1111-4111-8111-111111111111';
        const data = {
          id,
          buyer_trx_id: body.buyer_trx_id,
          sku_code: body.sku_code,
          product_name: '3 Diamonds',
          customer_target: body.customer_target,
          customer_target_zone: body.customer_target_zone || null,
          price: 1048,
          status: 'processing',
          serial_number: '',
          webhook_delivery_status: 'pending',
          is_sandbox: Boolean(body.sandbox_mode),
          created_at: '2026-11-20T08:00:00+00:00',
        };
        state.transactions.set(body.buyer_trx_id, data);
        return send(201, { success: true, message: 'Transaction successfully created and queued.', data });
      });
    }

    const trxMatch = url.pathname.match(/^\/api\/v1\/h2h\/transaction\/(.+)$/);
    if (req.method === 'GET' && trxMatch) {
      const data = state.transactions.get(decodeURIComponent(trxMatch[1]));
      if (!data) return send(404, { success: false, message: 'not found' });
      return send(200, { success: true, data });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/h2h/check-nickname') {
      return readBody((raw) => {
        const body = JSON.parse(raw);
        if (body.customer_target === '12345678') {
          return send(200, {
            success: true,
            data: {
              game_code: body.game_code, customer_target: body.customer_target,
              customer_target_zone: body.customer_target_zone || null,
              username: 'BosMoli', region: 'ID', region_type: 'country',
            },
            billing: { charged_mc: 0, free_remaining_today: 39, transaction_id: null },
          });
        }
        return send(404, { success: false, message: 'not found' });
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/h2h/check-nickname/games') {
      return send(200, {
        success: true,
        games: [
          {
            game_code: 'mobile-legends', name: 'Mobile Legends', type: 'game',
            zone_required: true, zone_values: null,
            params: [{ name: 'customer_target' }, { name: 'customer_target_zone' }],
            status: 'available',
          },
        ],
      });
    }

    return send(404, { success: false, message: 'stub: route tidak dikenal' });
  });
  return { server, state };
}

let stub;
let stubBase;
let app;
let appBase;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moonboy-e2e-'));
  process.env.MOONBOY_CONFIG = path.join(tmpDir, 'config.json');
  process.env.MOONBOY_DATA_DIR = path.join(tmpDir, 'data');

  stub = createStubMelo();
  await new Promise((resolve) => stub.server.listen(0, '127.0.0.1', resolve));
  stubBase = `http://127.0.0.1:${stub.server.address().port}/api/v1/h2h`;

  const { createApp } = require('../server');
  app = createApp({
    apiKey: 'test-api-key',
    secretKey: 'test-secret-key',
    webhookSecret: WEBHOOK_SECRET,
    sandbox: true,
    markupPercent: 12,
    rounding: 100,
    adminPin: '999999',
    meloBaseUrl: stubBase,
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  appBase = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  if (app) await new Promise((resolve) => app.close(resolve));
  if (stub) await new Promise((resolve) => stub.server.close(resolve));
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(route, options) {
  const res = await fetch(appBase + route, options);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

test('e2e: brands dari stub Melo', async () => {
  const { status, json } = await api('/api/brands');
  assert.equal(status, 200);
  assert.equal(json.demo, false);
  assert.equal(json.brands.length, 1);
  assert.equal(json.brands[0].brand_id, 10);
  assert.equal(json.brands[0].name, 'Mobile Legends (ID)');
});

test('e2e: products menggabungkan 2 halaman, hanya yang active, harga jual terhitung, modal tidak bocor', async () => {
  const { status, json } = await api('/api/products?brand_id=10');
  assert.equal(status, 200);
  assert.equal(json.demo, false);
  assert.equal(json.brand.name, 'Mobile Legends (ID)');
  assert.equal(json.products.length, 2, 'produk out_of_stock harus disaring');
  const p3 = json.products.find((p) => p.sku_code === 'MLID-S12');
  assert.equal(p3.sell_price, 1200, 'cost 1048 + markup 12% rounding 100 = 1200');
  assert.equal('price' in p3, false, 'harga modal Melo tidak boleh bocor ke browser');
  assert.equal('cost' in p3, false);
  assert.equal(p3.form.fields.length, 2);
  assert.equal(p3.form.fields[0].key, 'customer_target');
  assert.equal(p3.form.notice, 'Masukkan ID dan zone sesuai akun pembeli.');
  const p86 = json.products.find((p) => p.sku_code === 'MLID-S86');
  assert.equal(p86.sell_price, 19600);
});

test('e2e: check-nickname ketemu dan tidak ketemu', async () => {
  const ok = await api('/api/check-nickname?game_code=mobile-legends&target=12345678&zone=1234');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.found, true);
  assert.equal(ok.json.username, 'BosMoli');

  const no = await api('/api/check-nickname?game_code=mobile-legends&target=00000000&zone=1234');
  assert.equal(no.status, 200);
  assert.equal(no.json.found, false);
});

test('e2e: alur pesanan lengkap — buat, processing, webhook sukses, status akhir success', async () => {
  const created = await api('/api/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku_code: 'MLID-S12', customer_target: '12345678', customer_target_zone: '1234' }),
  });
  assert.equal(created.status, 201);
  const trxId = created.json.buyer_trx_id;
  assert.match(trxId, /^MB-/);
  assert.equal(created.json.status, 'processing');
  assert.equal(created.json.sell_price, 1200);

  const before2 = await api('/api/order/' + encodeURIComponent(trxId));
  assert.equal(before2.status, 200);
  assert.equal(before2.json.status, 'processing');

  // Webhook dengan signature SALAH harus ditolak 401 dan tidak mengubah status.
  const payload = {
    id: '11111111-1111-4111-8111-111111111111',
    buyer_trx_id: trxId,
    sku_code: 'MLID-S12',
    customer_target: '12345678',
    customer_target_zone: '1234',
    status: 'success',
    serial_number: 'SN-0001',
    is_sandbox: true,
    price_charged: 1048,
    created_at: '2026-11-20T08:00:00+00:00',
    updated_at: '2026-11-20T08:01:00+00:00',
  };
  const raw = JSON.stringify(payload);
  const bad = await fetch(appBase + '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': 'deadbeef' },
    body: raw,
  });
  assert.equal(bad.status, 401);
  const afterBad = await api('/api/order/' + encodeURIComponent(trxId));
  assert.equal(afterBad.json.status, 'processing', 'webhook invalid tidak boleh mengubah pesanan');

  // Webhook dengan signature BENAR.
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');
  const good = await fetch(appBase + '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': sig },
    body: raw,
  });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { received: true });

  const final = await api('/api/order/' + encodeURIComponent(trxId));
  assert.equal(final.json.status, 'success');
  assert.equal(final.json.serial_number, 'SN-0001');

  // Pengiriman ulang webhook yang sama = duplikat, tetap success.
  const dup = await fetch(appBase + '/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-H2H-Signature': sig },
    body: raw,
  });
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).duplicate, true);
});

test('e2e: admin — PIN salah ditolak, status tidak membocorkan kunci', async () => {
  const wrong = await api('/api/admin/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '000000' }),
  });
  assert.equal(wrong.status, 403);

  const ok = await api('/api/admin/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '999999' }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.keysSet.apiKey, true);
  assert.equal(JSON.stringify(ok.json).includes('test-api-key'), false, 'nilai kunci tidak boleh tampil');
  assert.equal(JSON.stringify(ok.json).includes('test-secret-key'), false);
});

test('e2e: halaman statis terlayani', async () => {
  const home = await fetch(appBase + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /MoonBoy Store/);
  const admin = await fetch(appBase + '/admin');
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Admin Toko/);
});
