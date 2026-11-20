// Cache katalog Melo (endpoint katalog dibatasi 20 req/menit per profil,
// jadi cache 5 menit WAJIB — sama seperti versi Node).
// Dua lapis:
//   1. Map di memori isolate (selalu aktif, perilaku identik versi Node).
//   2. Cache API Cloudflare (caches.default) bila tersedia — bertahan
//      lintas isolate di data center yang sama. Best-effort: kegagalan
//      lapis ini tidak pernah menggagalkan request.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_ORIGIN = 'https://cache.moonboy-store.internal/';

const mem = new Map(); // key -> { expires, value }
const knownKeys = new Set();

function cacheApi() {
  try {
    if (typeof caches !== 'undefined' && caches && caches.default) return caches.default;
  } catch { /* abaikan */ }
  return null;
}

export async function cacheGet(key) {
  const hit = mem.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) mem.delete(key);
  const api = cacheApi();
  if (api) {
    try {
      const res = await api.match(new Request(CACHE_ORIGIN + encodeURIComponent(key)));
      if (res) {
        const value = await res.json();
        mem.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
        return value;
      }
    } catch { /* best-effort */ }
  }
  return null;
}

export async function cacheSet(key, value) {
  mem.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  knownKeys.add(key);
  const api = cacheApi();
  if (api) {
    try {
      const res = new Response(JSON.stringify(value), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
        },
      });
      await api.put(new Request(CACHE_ORIGIN + encodeURIComponent(key)), res);
    } catch { /* best-effort */ }
  }
}

export async function cacheClear() {
  mem.clear();
  const api = cacheApi();
  if (api) {
    for (const key of knownKeys) {
      try { await api.delete(new Request(CACHE_ORIGIN + encodeURIComponent(key))); } catch { /* abaikan */ }
    }
  }
  knownKeys.clear();
}
