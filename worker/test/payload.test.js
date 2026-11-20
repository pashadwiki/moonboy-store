import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTransactionBody, newBuyerTrxId } from '../src/lib/payload.js';

// Kasus yang sama dengan test/payload.test.js versi Node.
test('buildTransactionBody membentuk payload sesuai dokumentasi Melo', () => {
  const body = buildTransactionBody(
    {
      sku_code: 'MLIDS12',
      customer_target: 12345678, // angka harus dipaksa jadi string
      customer_target_zone: '1234',
      buyer_trx_id: 'MB-TEST-1',
    },
    { sandbox: true }
  );
  assert.deepEqual(body, {
    sku_code: 'MLIDS12',
    customer_target: '12345678',
    buyer_trx_id: 'MB-TEST-1',
    sandbox_mode: true,
    customer_target_zone: '1234',
  });
});

test('zone kosong tidak dikirim', () => {
  const body = buildTransactionBody(
    { sku_code: 'FF-5', customer_target: '998877', customer_target_zone: '', buyer_trx_id: 'MB-TEST-2' },
    { sandbox: false }
  );
  assert.equal('customer_target_zone' in body, false);
  assert.equal(body.sandbox_mode, false);
});

test('additional_data kosong tidak dikirim, terisi dikirim apa adanya', () => {
  const kosong = buildTransactionBody(
    { sku_code: 'X', customer_target: '1', buyer_trx_id: 'MB-T3', additional_data: {} },
    { sandbox: true }
  );
  assert.equal('additional_data' in kosong, false);

  const terisi = buildTransactionBody(
    { sku_code: 'X', customer_target: '1', buyer_trx_id: 'MB-T4', additional_data: { email: 'a@b.c' } },
    { sandbox: true }
  );
  assert.deepEqual(terisi.additional_data, { email: 'a@b.c' });
});

test('sandbox_mode mengikuti config', () => {
  const on = buildTransactionBody({ sku_code: 'X', customer_target: '1', buyer_trx_id: 'MB-T5' }, { sandbox: true });
  const off = buildTransactionBody({ sku_code: 'X', customer_target: '1', buyer_trx_id: 'MB-T6' }, { sandbox: false });
  assert.equal(on.sandbox_mode, true);
  assert.equal(off.sandbox_mode, false);
});

test('newBuyerTrxId: format MB-, unik, maksimal 64 karakter', () => {
  const a = newBuyerTrxId();
  const b = newBuyerTrxId();
  assert.match(a, /^MB-[A-Z0-9]+-[A-F0-9]{8}$/);
  assert.notEqual(a, b);
  assert.ok(a.length <= 64, `panjang ${a.length} melebihi 64`);
});
