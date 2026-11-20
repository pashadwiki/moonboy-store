'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sellPrice } = require('../lib/pricing');

test('cost 1048, markup 12%, rounding 100 -> 1200', () => {
  assert.equal(sellPrice(1048, 12, 100), 1200);
});

test('cost 1597, markup 12%, rounding 100 -> 1800', () => {
  assert.equal(sellPrice(1597, 12, 100), 1800);
});

test('argumen default = markup 12, rounding 100', () => {
  assert.equal(sellPrice(1048), 1200);
});

test('tanpa markup, harga pas kelipatan tetap', () => {
  assert.equal(sellPrice(1000, 0, 100), 1000);
});

test('tanpa markup, harga bukan kelipatan dibulatkan ke atas', () => {
  assert.equal(sellPrice(1001, 0, 100), 1100);
});

test('rounding 1 membulatkan ke rupiah terdekat ke atas', () => {
  // 1048 * 1.12 = 1173.76 -> 1174
  assert.equal(sellPrice(1048, 12, 1), 1174);
});

test('cost sangat kecil tetap minimal satu kelipatan rounding', () => {
  assert.equal(sellPrice(1, 12, 100), 100);
});

test('rounding 500', () => {
  // 17500 * 1.12 = 19600 -> kelipatan 500 terdekat ke atas = 20000
  assert.equal(sellPrice(17500, 12, 500), 20000);
});

test('cost tidak valid melempar error', () => {
  assert.throws(() => sellPrice(-5, 12, 100));
  assert.throws(() => sellPrice('abc', 12, 100));
});
