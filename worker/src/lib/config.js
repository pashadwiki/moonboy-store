// Konfigurasi efektif MoonBoy Store di Cloudflare Workers.
//
// Di Workers tidak ada berkas config yang bisa ditulis, jadi:
//   1. Nilai bawaan berasal dari environment (wrangler [vars] / secrets):
//      MELO_API_KEY, MELO_SECRET_KEY, MELO_WEBHOOK_SECRET, ADMIN_PIN,
//      MARKUP_PERCENT, ROUNDING, SANDBOX, MELO_BASE_URL.
//   2. Pengaturan dari halaman /admin disimpan di KV binding SETTINGS
//      (satu objek JSON di key "settings") dan MENIMPA nilai environment.
//      Kunci Melo di KV bersifat write-only: tidak pernah dikembalikan
//      ke browser (hanya status terisi/belum).
//
// Nama field internal sama dengan versi Node (apiKey, secretKey,
// webhookSecret, sandbox, markupPercent, rounding, adminPin, meloBaseUrl)
// supaya logika handler tetap identik.

export const SETTINGS_KEY = 'settings';

const KV_FIELDS = ['apiKey', 'secretKey', 'webhookSecret', 'sandbox', 'markupPercent', 'rounding', 'adminPin'];

export const DEFAULTS = {
  apiKey: '',
  secretKey: '',
  webhookSecret: '',
  sandbox: true,
  markupPercent: 12,
  rounding: 100,
  adminPin: '123456', // placeholder — WAJIB diganti pemilik (lihat README/DEPLOY)
  meloBaseUrl: 'https://api.melostore.id/api/v1/h2h',
};

function parseBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return fallback;
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function envConfig(env) {
  const cfg = { ...DEFAULTS };
  if (env.MELO_API_KEY) cfg.apiKey = String(env.MELO_API_KEY);
  if (env.MELO_SECRET_KEY) cfg.secretKey = String(env.MELO_SECRET_KEY);
  if (env.MELO_WEBHOOK_SECRET) cfg.webhookSecret = String(env.MELO_WEBHOOK_SECRET);
  if (env.ADMIN_PIN) cfg.adminPin = String(env.ADMIN_PIN);
  if (env.MELO_BASE_URL) cfg.meloBaseUrl = String(env.MELO_BASE_URL);
  cfg.sandbox = parseBool(env.SANDBOX, cfg.sandbox);
  cfg.markupPercent = parseNumber(env.MARKUP_PERCENT, cfg.markupPercent);
  cfg.rounding = parseNumber(env.ROUNDING, cfg.rounding);
  return cfg;
}

export async function loadSettingsBlob(env) {
  if (!env || !env.SETTINGS) return {};
  try {
    const blob = await env.SETTINGS.get(SETTINGS_KEY, { type: 'json' });
    return blob && typeof blob === 'object' ? blob : {};
  } catch {
    return {};
  }
}

export async function saveSettingsBlob(env, blob) {
  if (!env || !env.SETTINGS) throw new Error('KV SETTINGS tidak terhubung.');
  await env.SETTINGS.put(SETTINGS_KEY, JSON.stringify(blob));
}

// Urutan resolusi: DEFAULTS < env < KV SETTINGS (admin).
export async function resolveConfig(env) {
  const cfg = envConfig(env || {});
  const blob = await loadSettingsBlob(env || {});
  for (const field of KV_FIELDS) {
    if (blob[field] !== undefined) cfg[field] = blob[field];
  }
  return cfg;
}

export function hasKeys(cfg) {
  return Boolean(cfg && cfg.apiKey && cfg.secretKey);
}
