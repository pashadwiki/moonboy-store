// Mock untuk harness test Worker: KV in-memory, stub API Melo (sebagai
// pengganti global fetch), dan binding ASSETS yang membaca ../public.
// Berkas ini hanya berisi definisi/ekspor — tanpa efek samping.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../src/worker.js';

export const STUB_BASE = 'https://stub.melo.test/api/v1/h2h';
export const WEBHOOK_SECRET = 'whsec-e2e';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export class MockKV {
  constructor() {
    this.store = new Map();
  }
  async get(key, options) {
    const v = this.store.get(key);
    if (v === undefined) return null;
    const type = typeof options === 'string' ? options : options && options.type;
    if (type === 'json') {
      try { return JSON.parse(v); } catch { return null; }
    }
    return v;
  }
  async put(key, value) {
    this.store.set(key, String(value));
  }
  async delete(key) {
    this.store.delete(key);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export const mockAssets = {
  async fetch(request) {
    const url = new URL(request.url);
    const filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname.replace(/^\/+/, '')));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return new Response('not found', { status: 404 });
    }
    try {
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  },
};

// Stub Melo: meniru bentuk respons dokumentasi Melo persis seperti stub
// pada test e2e versi Node (categories, pricelists 2 halaman, transaction,
// check-nickname, games). Menghitung panggilan per route untuk asersi cache,
// mencatat body create untuk asersi retry, dan bisa disuruh gagal 5xx
// pada create berikutnya lewat state.failNextCreates.
export function createStubMelo() {
  const state = {
    transactions: new Map(),
    counts: { brands: 0, pricelists: 0, create: 0, getTrx: 0, nickname: 0, games: 0 },
    createBodies: [],
    lastCreateHeaders: null,
    failNextCreates: 0,
  };

  const send = (status, obj) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const p = u.pathname;

    if (method === 'GET' && p === '/api/v1/h2h/pricelists/categories') {
      state.counts.brands++;
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

    if (method === 'GET' && p === '/api/v1/h2h/pricelists') {
      state.counts.pricelists++;
      const form = {
        fields: [
          { key: 'customer_target', name: 'User ID', type: 'text' },
          { key: 'customer_target_zone', name: 'Zone ID', type: 'text' },
        ],
        notice: { id: 'Masukkan ID dan zone sesuai akun pembeli.', en: 'Enter the ID and zone.' },
      };
      const brands = [{ id: 10, name: 'Mobile Legends (ID)', thumbnail: null, order: 1 }];
      if (!u.searchParams.get('cursor')) {
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

    if (method === 'POST' && p === '/api/v1/h2h/transaction') {
      state.counts.create++;
      state.lastCreateHeaders = init.headers || {};
      const body = JSON.parse(init.body);
      state.createBodies.push(body);
      if (state.failNextCreates > 0) {
        state.failNextCreates--;
        return send(500, { success: false, message: 'stub: internal error' });
      }
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
      state.transactions.set(id, data);
      return send(201, { success: true, message: 'Transaction successfully created and queued.', data });
    }

    const trxMatch = p.match(/^\/api\/v1\/h2h\/transaction\/(.+)$/);
    if (method === 'GET' && trxMatch) {
      state.counts.getTrx++;
      const data = state.transactions.get(decodeURIComponent(trxMatch[1]));
      if (!data) return send(404, { success: false, message: 'not found' });
      return send(200, { success: true, data });
    }

    if (method === 'POST' && p === '/api/v1/h2h/check-nickname') {
      state.counts.nickname++;
      const body = JSON.parse(init.body);
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
    }

    if (method === 'GET' && p === '/api/v1/h2h/check-nickname/games') {
      state.counts.games++;
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
  }

  return { fetchImpl, state };
}

export function makeEnv(overrides = {}) {
  return {
    ORDERS: new MockKV(),
    SETTINGS: new MockKV(),
    ASSETS: mockAssets,
    MELO_BASE_URL: STUB_BASE,
    ...overrides,
  };
}

export const testCtx = { waitUntil() {}, passThroughOnException() {} };

export async function call(env, route, options = {}) {
  const res = await worker.fetch(new Request('https://store.test' + route, options), env, testCtx);
  return res;
}

export async function callJson(env, route, options = {}) {
  const res = await call(env, route, options);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export function jsonPost(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
