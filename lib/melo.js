'use strict';

// Klien API Melo H2H. Semua request membawa Accept: application/json;
// endpoint terautentikasi juga membawa X-API-Key + X-Secret-Key.
// Kunci TIDAK PERNAH dikirim ke browser — klien ini hanya jalan di server.
function createMeloClient(getConfig) {
  async function request(method, route, { body, auth = true, timeoutMs = 15000 } = {}) {
    const cfg = getConfig();
    const base = String(cfg.meloBaseUrl || '').replace(/\/+$/, '');
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      headers['X-API-Key'] = cfg.apiKey;
      headers['X-Secret-Key'] = cfg.secretKey;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(base + route, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* respons non-JSON */ }
      return { status: res.status, json, text };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request,
    getProfile: () => request('GET', '/profile'),
    getBalance: () => request('GET', '/profile/balance'),
    getBrands: () => request('GET', '/pricelists/categories'),
    getProductsPage: (brandId, cursor) => {
      let route = `/pricelists?brand_id=${encodeURIComponent(brandId)}&limit=500`;
      if (cursor) route += `&cursor=${encodeURIComponent(cursor)}`;
      return request('GET', route);
    },
    createTransaction: (body) => request('POST', '/transaction', { body }),
    getTransaction: (id) => request('GET', `/transaction/${encodeURIComponent(id)}`),
    // Pemeriksaan nickname: endpoint POST /check-nickname WAJIB autentikasi
    // (yang publik tanpa auth hanya /check-nickname/games dan /check-nickname/plan).
    checkNickname: (body) => request('POST', '/check-nickname', { body }),
    getNicknameGames: () => request('GET', '/check-nickname/games', { auth: false }),
  };
}

module.exports = { createMeloClient };
