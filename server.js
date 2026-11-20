'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig, saveConfig, hasKeys } = require('./lib/config');
const { sellPrice } = require('./lib/pricing');
const { createMeloClient } = require('./lib/melo');
const { createOrderStore } = require('./lib/orders');
const { verifySignature } = require('./lib/webhook');
const { buildTransactionBody, newBuyerTrxId } = require('./lib/payload');
const demo = require('./lib/demo');

const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_TTL_MS = 5 * 60 * 1000; // katalog Melo dibatasi 20 req/menit -> cache wajib
const FINAL_STATUSES = new Set(['success', 'failed']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('body terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString('utf8'));
}

function normalizeForm(formKey, form) {
  if (!form || !Array.isArray(form.fields)) return null;
  return {
    key: formKey,
    fields: form.fields.map((f) => ({ key: f.key, name: f.name, type: f.type || 'text' })),
    notice: (form.notice && (form.notice.id || form.notice.en)) || null,
  };
}

function createApp(configOverrides = {}) {
  let config = { ...loadConfig(), ...configOverrides };
  const melo = createMeloClient(() => config);
  const orders = createOrderStore();
  const cache = new Map(); // key -> { expires, value }
  const skuIndex = new Map(); // sku_code -> { brand_id, name, cost }

  function cacheGet(key) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (hit) cache.delete(key);
    return null;
  }
  function cacheSet(key, value) {
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
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

  function adminStatus() {
    return {
      keysSet: {
        apiKey: Boolean(config.apiKey),
        secretKey: Boolean(config.secretKey),
        webhookSecret: Boolean(config.webhookSecret),
      },
      sandbox: Boolean(config.sandbox),
      markupPercent: config.markupPercent,
      rounding: config.rounding,
      active: hasKeys(config),
    };
  }

  // ---------- katalog ----------

  async function handleBrands(res) {
    if (!hasKeys(config)) {
      return sendJson(res, 200, { demo: true, brands: demo.BRANDS });
    }
    const cached = cacheGet('brands');
    if (cached) return sendJson(res, 200, { demo: false, brands: cached });
    let r;
    try {
      r = await melo.getBrands();
    } catch {
      return sendJson(res, 502, { error: 'Gagal menghubungi Melo. Coba lagi sebentar.' });
    }
    if (r.status !== 200 || !r.json || r.json.success !== true || !Array.isArray(r.json.data)) {
      return sendJson(res, 502, { error: 'Gagal mengambil daftar brand dari Melo.' });
    }
    const brands = r.json.data.map((b) => ({
      brand_id: b.brand_id,
      name: b.name,
      slug: b.slug,
      category: (b.category && b.category.name) || null,
      types: Array.isArray(b.type) ? b.type.map((t) => t.name) : [],
    }));
    cacheSet('brands', brands);
    return sendJson(res, 200, { demo: false, brands });
  }

  async function fetchBrandProducts(brandId) {
    const cacheKey = `products:${brandId}`;
    const cached = cacheGet(cacheKey);
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
        sell_price: sellPrice(p.price, config.markupPercent, config.rounding),
        form: normalizeForm(p.inquiry_form_key, forms[p.inquiry_form_key]),
      });
    }
    const result = { brand: { brand_id: isNaN(Number(brandId)) ? brandId : Number(brandId), name: brandName }, products };
    cacheSet(cacheKey, result);
    return result;
  }

  async function handleProducts(res, url) {
    const brandId = url.searchParams.get('brand_id');
    if (!brandId) return sendJson(res, 400, { error: 'Parameter brand_id wajib diisi.' });
    if (!hasKeys(config)) {
      const entry = demo.PRODUCTS[brandId];
      if (!entry) return sendJson(res, 404, { error: 'Brand demo tidak ditemukan.' });
      const products = entry.items.map((p) => ({
        sku_code: p.sku_code,
        name: p.name,
        type_name: p.type_name,
        sell_price: sellPrice(p.cost, config.markupPercent, config.rounding),
        form: p.form,
      }));
      return sendJson(res, 200, { demo: true, brand: entry.brand, products });
    }
    try {
      const result = await fetchBrandProducts(brandId);
      return sendJson(res, 200, { demo: false, ...result });
    } catch {
      return sendJson(res, 502, { error: 'Gagal mengambil daftar produk dari Melo.' });
    }
  }

  // ---------- nickname ----------

  async function handleNicknameGames(res) {
    try {
      const r = await melo.getNicknameGames();
      if (r.status !== 200 || !r.json || !Array.isArray(r.json.games)) {
        return sendJson(res, 502, { error: 'Daftar game untuk cek nickname tidak tersedia.' });
      }
      const games = r.json.games
        .filter((g) => g.status === 'available')
        .map((g) => ({ game_code: g.game_code, name: g.name, zone_required: Boolean(g.zone_required) }));
      return sendJson(res, 200, { games });
    } catch {
      return sendJson(res, 502, { error: 'Daftar game untuk cek nickname tidak tersedia.' });
    }
  }

  async function handleCheckNickname(res, url) {
    const gameCode = url.searchParams.get('game_code');
    const target = url.searchParams.get('target');
    const zone = url.searchParams.get('zone');
    if (!gameCode || !target) {
      return sendJson(res, 400, { error: 'Parameter game_code dan target wajib diisi.' });
    }
    if (!hasKeys(config)) {
      return sendJson(res, 503, { error: 'Toko belum aktif. Cek nickname belum bisa dipakai.' });
    }
    const body = { game_code: gameCode, customer_target: String(target) };
    if (zone) body.customer_target_zone = String(zone);
    let r;
    try {
      r = await melo.checkNickname(body);
    } catch {
      return sendJson(res, 502, { error: 'Gagal menghubungi Melo untuk cek nickname.' });
    }
    if (r.status === 404) return sendJson(res, 200, { found: false });
    if (r.status === 200 && r.json && r.json.data) {
      return sendJson(res, 200, {
        found: true,
        username: r.json.data.username || null,
        region: r.json.data.region || null,
      });
    }
    if (r.status === 429) return sendJson(res, 429, { error: 'Kuota cek nickname habis untuk sekarang. Coba lagi nanti.' });
    return sendJson(res, 502, { error: 'Cek nickname gagal. Periksa lagi ID kamu.' });
  }

  // ---------- pesanan ----------

  async function handleCreateOrder(req, res) {
    let input;
    try {
      input = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Format data pesanan tidak valid.' });
    }
    if (!input.sku_code || !input.customer_target) {
      return sendJson(res, 400, { error: 'Produk dan ID tujuan wajib diisi.' });
    }
    if (!hasKeys(config)) {
      return sendJson(res, 503, {
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
      sell_price: known ? sellPrice(known.cost, config.markupPercent, config.rounding) : null,
      status: 'created',
      serial_number: null,
      price_charged: null,
      error_code: null,
      error_message: null,
      sandbox: Boolean(config.sandbox),
      events: [],
      created_at: now,
      updated_at: now,
    };
    orders.upsert(order);

    const body = buildTransactionBody({ ...input, buyer_trx_id: buyerTrxId }, config);
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
          order.sell_price = sellPrice(d.price, config.markupPercent, config.rounding);
        }
      }
      order.updated_at = new Date().toISOString();
      orders.upsert(order);
      return sendJson(res, 201, { buyer_trx_id: buyerTrxId, status: order.status, sell_price: order.sell_price });
    }

    if (r && r.status >= 400 && r.status < 500) {
      const msg = (r.json && (r.json.message || (r.json.errors && JSON.stringify(r.json.errors)))) || 'Pesanan ditolak oleh Melo.';
      order.status = 'failed';
      order.error_message = msg;
      order.updated_at = new Date().toISOString();
      orders.upsert(order);
      return sendJson(res, r.status, { error: msg, buyer_trx_id: buyerTrxId });
    }

    // Hasil belum pasti (timeout/5xx setelah retry). Pesanan mungkin sudah
    // diterima Melo; halaman status akan memastikan lewat GET /transaction.
    return sendJson(res, 202, {
      buyer_trx_id: buyerTrxId,
      status: order.status,
      sell_price: order.sell_price,
      note: 'Pesanan terkirim, menunggu konfirmasi dari Melo.',
    });
  }

  async function handleGetOrder(res, buyerTrxId) {
    const order = orders.get(buyerTrxId);
    if (!order) return sendJson(res, 404, { error: 'Pesanan tidak ditemukan.' });
    if (hasKeys(config) && !FINAL_STATUSES.has(order.status)) {
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
          orders.upsert(order);
        }
      } catch { /* tampilkan data lokal bila Melo tak terjangkau */ }
    }
    return sendJson(res, 200, publicOrder(order));
  }

  // ---------- webhook ----------

  async function handleWebhook(req, res) {
    const raw = await readRawBody(req);
    const signature = req.headers['x-h2h-signature'];
    if (!config.webhookSecret || !verifySignature(raw, signature, config.webhookSecret)) {
      return sendJson(res, 401, { error: 'invalid signature' });
    }
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }

    const isFinal = payload && FINAL_STATUSES.has(payload.status) && payload.buyer_trx_id;
    if (isFinal) {
      const order = orders.get(payload.buyer_trx_id) || orders.getByMeloId(payload.id);
      if (order) {
        const dedupeKey = `${payload.id || ''}:${payload.status}`;
        if (Array.isArray(order.events) && order.events.includes(dedupeKey)) {
          return sendJson(res, 200, { received: true, duplicate: true });
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
        orders.upsert(order);
        return sendJson(res, 200, { received: true });
      }
      return sendJson(res, 200, { received: true, matched: false });
    }

    // Event non-final (mis. transaction.action_change): catat, jangan
    // menyelesaikan pesanan.
    if (payload && payload.buyer_trx_id) {
      const order = orders.get(payload.buyer_trx_id) || orders.getByMeloId(payload.id);
      if (order) {
        order.action_events = Array.isArray(order.action_events) ? order.action_events : [];
        order.action_events.push({ at: new Date().toISOString(), event: payload.event || 'unknown' });
        order.updated_at = new Date().toISOString();
        orders.upsert(order);
      }
    }
    return sendJson(res, 200, { received: true });
  }

  // ---------- admin ----------

  function checkPin(input) {
    return input && typeof input.pin === 'string' && input.pin === String(config.adminPin);
  }

  async function handleAdminStatus(req, res) {
    let input;
    try { input = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'Format tidak valid.' }); }
    if (!checkPin(input)) return sendJson(res, 403, { error: 'PIN salah.' });
    return sendJson(res, 200, adminStatus());
  }

  async function handleAdminConfig(req, res) {
    let input;
    try { input = await readJsonBody(req); } catch { return sendJson(res, 400, { error: 'Format tidak valid.' }); }
    if (!checkPin(input)) return sendJson(res, 403, { error: 'PIN salah.' });
    // String kosong = biarkan nilai lama (kunci tidak pernah ditimpa tanpa sengaja).
    if (typeof input.apiKey === 'string' && input.apiKey.length > 0) config.apiKey = input.apiKey;
    if (typeof input.secretKey === 'string' && input.secretKey.length > 0) config.secretKey = input.secretKey;
    if (typeof input.webhookSecret === 'string' && input.webhookSecret.length > 0) config.webhookSecret = input.webhookSecret;
    if (typeof input.sandbox === 'boolean') config.sandbox = input.sandbox;
    if (Number.isFinite(Number(input.markupPercent)) && input.markupPercent !== undefined && input.markupPercent !== null && input.markupPercent !== '') {
      config.markupPercent = Math.min(1000, Math.max(0, Number(input.markupPercent)));
    }
    if (Number.isFinite(Number(input.rounding)) && input.rounding !== undefined && input.rounding !== null && input.rounding !== '') {
      config.rounding = Math.max(1, Math.floor(Number(input.rounding)));
    }
    if (typeof input.newPin === 'string' && input.newPin.length >= 4) config.adminPin = input.newPin;
    saveConfig(config);
    cache.clear();
    return sendJson(res, 200, adminStatus());
  }

  // ---------- static ----------

  function serveStatic(res, urlPath) {
    let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    if (rel === 'admin') rel = 'admin.html';
    const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 404, { error: 'Tidak ditemukan.' });
    fs.readFile(filePath, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'Tidak ditemukan.' });
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (p === '/api/brands' && req.method === 'GET') return await handleBrands(res);
      if (p === '/api/products' && req.method === 'GET') return await handleProducts(res, url);
      if (p === '/api/nickname-games' && req.method === 'GET') return await handleNicknameGames(res);
      if (p === '/api/check-nickname' && req.method === 'GET') return await handleCheckNickname(res, url);
      if (p === '/api/order' && req.method === 'POST') return await handleCreateOrder(req, res);
      const orderMatch = p.match(/^\/api\/order\/(.+)$/);
      if (orderMatch && req.method === 'GET') return await handleGetOrder(res, decodeURIComponent(orderMatch[1]));
      if (p === '/webhook' && req.method === 'POST') return await handleWebhook(req, res);
      if (p === '/api/admin/status' && req.method === 'POST') return await handleAdminStatus(req, res);
      if (p === '/api/admin/config' && req.method === 'POST') return await handleAdminConfig(req, res);
      if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, p);
      return sendJson(res, 405, { error: 'Metode tidak didukung.' });
    } catch (err) {
      return sendJson(res, 500, { error: 'Terjadi kesalahan di server.' });
    }
  });

  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`MoonBoy Store jalan di http://localhost:${port}`);
  });
}

module.exports = { createApp };
