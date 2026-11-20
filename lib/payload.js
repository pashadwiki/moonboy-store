'use strict';

const crypto = require('node:crypto');

// Referensi pesanan unik milik kita; wajib untuk POST /transaction Melo.
// Maks 64 karakter. Format: MB-<base36 timestamp>-<8 hex acak> (~20 char).
function newBuyerTrxId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `MB-${ts}-${rand}`;
}

// Bentuk body POST /transaction (reguler) sesuai dokumentasi Melo:
// field pertama form -> customer_target, kedua -> customer_target_zone,
// sisanya -> additional_data (keyed by form field key).
function buildTransactionBody(input, cfg) {
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

module.exports = { newBuyerTrxId, buildTransactionBody };
