// Referensi pesanan unik milik kita; wajib untuk POST /transaction Melo.
// Maks 64 karakter. Format: MB-<base36 timestamp>-<8 hex acak> (~20 char).
// Port dari versi Node: crypto.randomBytes -> crypto.getRandomValues (WebCrypto,
// tersedia di Workers dan Node >= 19).
export function newBuyerTrxId() {
  const ts = Date.now().toString(36).toUpperCase();
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (const b of bytes) rand += b.toString(16).padStart(2, '0');
  return `MB-${ts}-${rand.toUpperCase()}`;
}

// Bentuk body POST /transaction (reguler) sesuai dokumentasi Melo:
// field pertama form -> customer_target, kedua -> customer_target_zone,
// sisanya -> additional_data (keyed by form field key).
export function buildTransactionBody(input, cfg) {
  const body = {
    sku_code: input.sku_code,
    customer_target: String(input.customer_target),
    buyer_trx_id: input.buyer_trx_id,
    sandbox_mode: Boolean(cfg && cfg.sandbox),
  };
  if (input.customer_target_zone !== undefined && input.customer_target_zone !== null && input.customer_target_zone !== '') {
    body.customer_target_zone = String(input.customer_target_zone);
  }
  if (input.additional_data && typeof input.additional_data === 'object' && Object.keys(input.additional_data).length > 0) {
    body.additional_data = input.additional_data;
  }
  return body;
}
