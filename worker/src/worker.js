// MoonBoy Store — Cloudflare Workers port dari versi Node (../server.js).
// Perilaku endpoint identik: katalog Melo (cache 5 menit), cek nickname,
// pesanan dengan buyer_trx_id, webhook HMAC, admin ber-PIN, mode demo.
// Perbedaan platform saja yang disesuaikan:
//   - config: env vars/secrets + KV SETTINGS (menimpa env) — lihat lib/config.js
//   - pesanan: KV ORDERS — lihat lib/orders.js
//   - verifikasi webhook: WebCrypto asinkron — lihat lib/webhook.js
//   - berkas statis: Workers static assets (binding ASSETS)
import { resolveConfig, loadSettingsBlob, saveSettingsBlob, hasKeys } from './lib/config.js';
import { sellPrice } from './lib/pricing.js';
import { createMeloClient } from './lib/melo.js';
import { createOrderStore } from './lib/orders.js';
import { verifySignature } from './lib/webhook.js';
import { buildTransactionBody, newBuyerTrxId } from './lib/payload.js';
import { cacheGet, cacheSet, cacheClear } from './lib/cache.js';
import * as demo from './lib/demo.js';

const FINAL_STATUSES = new Set(['success', 'failed']);
const MAX_BODY_BYTES = 1024 * 1024; // sama dengan batas versi Node

// Indeks SKU di memori isolate (diisi saat katalog produk diambil) —
// perilaku sama dengan versi Node; bila tidak ada, harga jual dihitung
// dari field price pada respons create transaksi Melo.
const skuIndex = new Map(); // sku_code -> { brand_id, name, cost }

function sendJson(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function readJsonBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error('body terlalu besar');
  if (raw.length === 0) return {};
  return JSON.parse(raw);
}

function normalizeForm(formKey, form) {
  if (!form || !Array.isArray(form.fields)) return null;
  return {
    key: formKey,
    fields: form.fields.map((f) => ({ key: f.key, name: f.name, type: f.type || 'text' })),
    notice: (form.notice && (form.notice.id || form.notice.en)) || null,
  };
}

function publicOrder(order) {
  return {
    buyer_trx_id: order.buyer_trx_id,
    product_name: order.product_name || null,
    sku_code: order.sku_code,
    customer_target: order.customer_target,
    customer_target_zone: order.customer_target_zone || null,
    status: order.status,
    sell_price: order.sell_price,
    serial_number: order.serial_number || null,
    is_sandbox: Boolean(order.sandbox),
    error_message: order.error_message || null,
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

function adminStatus(cfg) {
  return {
    keysSet: {
      apiKey: Boolean(cfg.apiKey),
      secretKey: Boolean(cfg.secretKey),
      webhookSecret: Boolean(cfg.webhookSecret),
    },
    sandbox: Boolean(cfg.sandbox),
    markupPercent: cfg.markupPercent,
    rounding: cfg.rounding,
    active: hasKeys(cfg),
  };
}

// ---------- katalog ----------

async function handleBrands(cfg, melo) {
  if (!hasKeys(cfg)) {
    return sendJson(200, { demo: true, brands: demo.BRANDS });
  }
  const cached = await cacheGet('brands');
  if (cached) return sendJson(200, { demo: false, brands: cached });
  let r;
  try {
    r = await melo.getBrands();
  } catch {
    return sendJson(502, { error: 'Gagal menghubungi Melo. Coba lagi sebentar.' });
  }
  if (r.status !== 200 || !r.json || r.json.success !== true || !Array.isArray(r.json.data)) {
    return sendJson(502, { error: 'Gagal mengambil daftar brand dari Melo.' });
  }
  const brands = r.json.data.map((b) => ({
    brand_id: b.brand_id,
    name: b.name,
    slug: b.slug,
    category: (b.category && b.category.name) || null,
    types: Array.isArray(b.type) ? b.type.map((t) => t.name) : [],
  }));
  await cacheSet('brands', brands);
  return sendJson(200, { demo: false, brands });
}

async function fetchBrandProducts(cfg, melo, brandId) {
  const cacheKey = `products:${brandId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;
  let cursor = null;
  const items = [];
  let forms = {};
  let brandName = null;
  do {
    const r = await melo.getProductsPage(brandId, cursor);
    if (r.status !== 200 || !r.json || r.json.success !== true) {
      throw new Error(`Melo pricelists gagal (HTTP ${r.status})`);
    }
    const j = r.json;
    if (Array.isArray(j.data)) items.push(...j.data);
    if (j.meta && j.meta.inquiry_forms) forms = { ...forms, ...j.meta.inquiry_forms };
    if (j.meta && Array.isArray(j.meta.brands)) {
      const found = j.meta.brands.find((b) => String(b.id) === String(brandId));
      if (found) brandName = found.name;
    }
    const pg = (j.meta && j.meta.pagination) || {};
    cursor = pg.has_more && pg.next_cursor ? pg.next_cursor : null;
  } while (cursor);

  const products = [];
  for (const p of items) {
    if (p.status !== 'active') continue;
    skuIndex.set(p.sku_code, { brand_id: brandId, name: p.name, cost: p.price });
    products.push({
      sku_code: p.sku_code,
      name: p.name,
      type_name: p.type_name || null,
      sell_price: sellPrice(p.price, cfg.markupPercent, cfg.rounding),
      form: normalizeForm(p.inquiry_form_key, forms[p.inquiry_form_key]),
    });
  }
  const result = { brand: { brand_id: isNaN(Number(brandId)) ? brandId : Number(brandId), name: brandName }, products };
  await cacheSet(cacheKey, result);
  return result;
}

async function handleProducts(cfg, melo, url) {
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) return sendJson(400, { error: 'Parameter brand_id wajib diisi.' });
  if (!hasKeys(cfg)) {
    const entry = demo.PRODUCTS[brandId];
    if (!entry) return sendJson(404, { error: 'Brand demo tidak ditemukan.' });
    const products = entry.items.map((p) => ({
      sku_code: p.sku_code,
      name: p.name,
      type_name: p.type_name,
      sell_price: sellPrice(p.cost, cfg.markupPercent, cfg.rounding),
      form: p.form,
    }));
    return sendJson(200, { demo: true, brand: entry.brand, products });
  }
  try {
    const result = await fetchBrandProducts(cfg, melo, brandId);
    return sendJson(200, { demo: false, ...result });
  } catch {
    return sendJson(502, { error: 'Gagal mengambil daftar produk dari Melo.' });
  }
}

// ---------- nickname ----------

async function handleNicknameGames(melo) {
  try {
    const r = await melo.getNicknameGames();
    if (r.status !== 200 || !r.json || !Array.isArray(r.json.games)) {
      return sendJson(502, { error: 'Daftar game untuk cek nickname tidak tersedia.' });
    }
    const games = r.json.games
      .filter((g) => g.status === 'available')
      .map((g) => ({ game_code: g.game_code, name: g.name, zone_required: Boolean(g.zone_required) }));
    return sendJson(200, { games });
  } catch {
    return sendJson(502, { error: 'Daftar game untuk cek nickname tidak tersedia.' });
  }
}

async function doCheckNickname(cfg, melo, gameCode, target, zone) {
  if (!gameCode || !target) {
    return sendJson(400, { error: 'Parameter game_code dan target wajib diisi.' });
  }
  if (!hasKeys(cfg)) {
    return sendJson(503, { error: 'Toko belum aktif. Cek nickname belum bisa dipakai.' });
  }
  const body = { game_code: gameCode, customer_target: String(target) };
  if (zone) body.customer_target_zone = String(zone);
  let r;
  try {
    r = await melo.checkNickname(body);
  } catch {
    return sendJson(502, { error: 'Gagal menghubungi Melo untuk cek nickname.' });
  }
  if (r.status === 404) return sendJson(200, { found: false });
  if (r.status === 200 && r.json && r.json.data) {
    return sendJson(200, {
      found: true,
      username: r.json.data.username || null,
      region: r.json.data.region || null,
    });
  }
  if (r.status === 429) return sendJson(429, { error: 'Kuota cek nickname habis untuk sekarang. Coba lagi nanti.' });
  return sendJson(502, { error: 'Cek nickname gagal. Periksa lagi ID kamu.' });
}

// GET dipakai frontend yang sudah ada (query: game_code, target, zone).
async function handleCheckNicknameGet(cfg, melo, url) {
  return doCheckNickname(
    cfg,
    melo,
    url.searchParams.get('game_code'),
    url.searchParams.get('target'),
    url.searchParams.get('zone')
  );
}

// POST (body JSON) — bentuk yang sama, menerima target/customer_target
// dan zone/customer_target_zone.
async function handleCheckNicknamePost(cfg, melo, request) {
  let input;
  try {
    input = await readJsonBody(request);
  } catch {
    return sendJson(400, { error: 'Format data tidak valid.' });
  }
  return doCheckNickname(
    cfg,
    melo,
    input.game_code,
    input.target !== undefined ? input.target : input.customer_target,
    input.zone !== undefined ? input.zone : input.customer_target_zone
  );
}

// ---------- pesanan ----------

async function handleCreateOrder(cfg, melo, orders, request) {
  let input;
  try {
    input = await readJsonBody(request);
  } catch {
    return sendJson(400, { error: 'Format data pesanan tidak valid.' });
  }
  if (!input.sku_code || !input.customer_target) {
    return sendJson(400, { error: 'Produk dan ID tujuan wajib diisi.' });
  }
  if (!hasKeys(cfg)) {
    return sendJson(503, {
      error: 'Toko belum aktif. Pemilik toko belum menghubungkan akun Melo, jadi pesanan belum bisa diproses.',
    });
  }

  const buyerTrxId = newBuyerTrxId();
  const known = skuIndex.get(input.sku_code);
  const now = new Date().toISOString();
  const order = {
    buyer_trx_id: buyerTrxId,
    melo_id: null,
    sku_code: input.sku_code,
    product_name: known ? known.name : null,
    customer_target: String(input.customer_target),
    customer_target_zone: input.customer_target_zone ? String(input.customer_target_zone) : null,
    additional_data: input.additional_data && typeof input.additional_data === 'object' ? input.additional_data : null,
    cost: known ? known.cost : null,
    sell_price: known ? sellPrice(known.cost, cfg.markupPercent, cfg.rounding) : null,
    status: 'created',
    serial_number: null,
    price_charged: null,
    error_code: null,
    error_message: null,
    sandbox: Boolean(cfg.sandbox),
    events: [],
    created_at: now,
    updated_at: now,
  };
  await orders.upsert(order);

  const body = buildTransactionBody({ ...input, buyer_trx_id: buyerTrxId }, cfg);
  let r = null;
  let networkError = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      r = await melo.createTransaction(body);
      networkError = false;
    } catch {
      r = null;
      networkError = true;
    }
    // Sesuai dokumentasi: timeout/5xx -> ulangi request yang sama
    // dengan buyer_trx_id yang sama persis.
    if (!networkError && r && r.status < 500) break;
  }

  if (r && (r.status === 201 || r.status === 200) && r.json && r.json.data) {
    const d = r.json.data;
    order.melo_id = d.id || null;
    order.status = d.status || 'processing';
    order.product_name = d.product_name || order.product_name;
    if (typeof d.price === 'number') {
      order.cost = d.price;
      if (order.sell_price === null) {
        order.sell_price = sellPrice(d.price, cfg.markupPercent, cfg.rounding);
      }
    }
    order.updated_at = new Date().toISOString();
    await orders.upsert(order);
    return sendJson(201, { buyer_trx_id: buyerTrxId, status: order.status, sell_price: order.sell_price });
  }

  if (r && r.status >= 400 && r.status < 500) {
    const msg = (r.json && (r.json.message || (r.json.errors && JSON.stringify(r.json.errors)))) || 'Pesanan ditolak oleh Melo.';
    order.status = 'failed';
    order.error_message = msg;
    order.updated_at = new Date().toISOString();
    await orders.upsert(order);
    return sendJson(r.status, { error: msg, buyer_trx_id: buyerTrxId });
  }

  // Hasil belum pasti (timeout/5xx setelah retry). Pesanan mungkin sudah
  // diterima Melo; halaman status akan memastikan lewat GET /transaction.
  return sendJson(202, {
    buyer_trx_id: buyerTrxId,
    status: order.status,
    sell_price: order.sell_price,
    note: 'Pesanan terkirim, menunggu konfirmasi dari Melo.',
  });
}

async function handleGetOrder(cfg, melo, orders, buyerTrxId) {
  const order = await orders.get(buyerTrxId);
  if (!order) return sendJson(404, { error: 'Pesanan tidak ditemukan.' });
  if (hasKeys(cfg) && !FINAL_STATUSES.has(order.status)) {
    try {
      const r = await melo.getTransaction(order.melo_id || buyerTrxId);
      if (r.status === 200 && r.json && r.json.data) {
        const d = r.json.data;
        order.melo_id = d.id || order.melo_id;
        order.status = d.status || order.status;
        order.product_name = d.product_name || order.product_name;
        if (d.serial_number) order.serial_number = d.serial_number;
        if (typeof d.price === 'number') order.price_charged = d.price;
        order.updated_at = new Date().toISOString();
        await orders.upsert(order);
      }
    } catch { /* tampilkan data lokal bila Melo tak terjangkau */ }
  }
  return sendJson(200, publicOrder(order));
}

// ---------- webhook ----------

async function handleWebhook(cfg, orders, request) {
  const rawText = await request.text();
  if (rawText.length > MAX_BODY_BYTES) throw new Error('body terlalu besar');
  const signature = request.headers.get('x-h2h-signature');
  if (!cfg.webhookSecret || !(await verifySignature(rawText, signature, cfg.webhookSecret))) {
    return sendJson(401, { error: 'invalid signature' });
  }
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return sendJson(400, { error: 'invalid json' });
  }

  const isFinal = payload && FINAL_STATUSES.has(payload.status) && payload.buyer_trx_id;
  if (isFinal) {
    const order = (await orders.get(payload.buyer_trx_id)) || (await orders.getByMeloId(payload.id));
    if (order) {
      const dedupeKey = `${payload.id || ''}:${payload.status}`;
      if (Array.isArray(order.events) && order.events.includes(dedupeKey)) {
        return sendJson(200, { received: true, duplicate: true });
      }
      order.status = payload.status;
      order.melo_id = payload.id || order.melo_id;
      if (payload.serial_number) order.serial_number = payload.serial_number;
      if (typeof payload.price_charged === 'number') order.price_charged = payload.price_charged;
      if (payload.fulfilled_sku_code) order.fulfilled_sku_code = payload.fulfilled_sku_code;
      if (payload.status === 'failed') {
        order.error_code = payload.error_code || null;
        order.error_message = payload.message || 'Pesanan gagal diproses.';
      }
      order.events = Array.isArray(order.events) ? order.events : [];
      order.events.push(dedupeKey);
      order.updated_at = new Date().toISOString();
      await orders.upsert(order);
      return sendJson(200, { received: true });
    }
    return sendJson(200, { received: true, matched: false });
  }

  // Event non-final (mis. transaction.action_change): catat, jangan
  // menyelesaikan pesanan.
  if (payload && payload.buyer_trx_id) {
    const order = (await orders.get(payload.buyer_trx_id)) || (await orders.getByMeloId(payload.id));
    if (order) {
      order.action_events = Array.isArray(order.action_events) ? order.action_events : [];
      order.action_events.push({ at: new Date().toISOString(), event: payload.event || 'unknown' });
      order.updated_at = new Date().toISOString();
      await orders.upsert(order);
    }
  }
  return sendJson(200, { received: true });
}

// ---------- admin ----------

function checkPin(cfg, input) {
  return input && typeof input.pin === 'string' && input.pin === String(cfg.adminPin);
}

async function handleAdminStatus(cfg, request) {
  let input;
  try { input = await readJsonBody(request); } catch { return sendJson(400, { error: 'Format tidak valid.' }); }
  if (!checkPin(cfg, input)) return sendJson(403, { error: 'PIN salah.' });
  return sendJson(200, adminStatus(cfg));
}

async function handleAdminConfig(env, cfg, request) {
  let input;
  try { input = await readJsonBody(request); } catch { return sendJson(400, { error: 'Format tidak valid.' }); }
  if (!checkPin(cfg, input)) return sendJson(403, { error: 'PIN salah.' });
  // Muat blob KV saat ini, terapkan perubahan dengan semantik yang sama
  // dengan versi Node: string kosong = biarkan nilai lama (kunci tidak
  // pernah ditimpa tanpa sengaja).
  const blob = await loadSettingsBlob(env);
  if (typeof input.apiKey === 'string' && input.apiKey.length > 0) blob.apiKey = input.apiKey;
  if (typeof input.secretKey === 'string' && input.secretKey.length > 0) blob.secretKey = input.secretKey;
  if (typeof input.webhookSecret === 'string' && input.webhookSecret.length > 0) blob.webhookSecret = input.webhookSecret;
  if (typeof input.sandbox === 'boolean') blob.sandbox = input.sandbox;
  if (Number.isFinite(Number(input.markupPercent)) && input.markupPercent !== undefined && input.markupPercent !== null && input.markupPercent !== '') {
    blob.markupPercent = Math.min(1000, Math.max(0, Number(input.markupPercent)));
  }
  if (Number.isFinite(Number(input.rounding)) && input.rounding !== undefined && input.rounding !== null && input.rounding !== '') {
    blob.rounding = Math.max(1, Math.floor(Number(input.rounding)));
  }
  if (typeof input.newPin === 'string' && input.newPin.length >= 4) blob.adminPin = input.newPin;
  await saveSettingsBlob(env, blob);
  await cacheClear();
  const updated = await resolveConfig(env);
  return sendJson(200, adminStatus(updated));
}

// ---------- static ----------

async function serveStatic(env, request, url) {
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';
  else if (pathname === '/admin') pathname = '/admin.html';
  if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    const assetUrl = new URL(pathname, url.origin);
    const res = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method }));
    if (res.status !== 404) return res;
  }
  return sendJson(404, { error: 'Tidak ditemukan.' });
}

// ---------- router ----------

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const p = url.pathname;
  const method = request.method;

  // Webhook tidak butuh config katalog; resolusi config tetap satu kali.
  const cfg = await resolveConfig(env);
  const melo = createMeloClient(cfg);
  const orders = createOrderStore(env.ORDERS);

  if (p === '/api/brands' && method === 'GET') return handleBrands(cfg, melo);
  if (p === '/api/products' && method === 'GET') return handleProducts(cfg, melo, url);
  if (p === '/api/nickname-games' && method === 'GET') return handleNicknameGames(melo);
  if (p === '/api/check-nickname' && method === 'GET') return handleCheckNicknameGet(cfg, melo, url);
  if (p === '/api/check-nickname' && method === 'POST') return handleCheckNicknamePost(cfg, melo, request);
  if (p === '/api/order' && method === 'POST') return handleCreateOrder(cfg, melo, orders, request);
  const orderMatch = p.match(/^\/api\/order\/(.+)$/);
  if (orderMatch && method === 'GET') return handleGetOrder(cfg, melo, orders, decodeURIComponent(orderMatch[1]));
  if (p === '/webhook' && method === 'POST') return handleWebhook(cfg, orders, request);
  if (p === '/api/admin/status' && method === 'POST') return handleAdminStatus(cfg, request);
  if (p === '/api/admin/config' && method === 'POST') return handleAdminConfig(env, cfg, request);
  if (p.startsWith('/api/')) return sendJson(404, { error: 'Endpoint tidak ditemukan.' });
  if (method === 'GET' || method === 'HEAD') return serveStatic(env, request, url);
  return sendJson(405, { error: 'Metode tidak didukung.' });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env || {});
    } catch (err) {
      return sendJson(500, { error: 'Terjadi kesalahan di server.' });
    }
  },
};
