'use strict';

// Harga jual = modal + markup, dibulatkan KE ATAS ke kelipatan `rounding`.
// Contoh: cost 1048, markup 12%, rounding 100 -> 1048*1.12 = 1173.76 -> 1200.
function sellPrice(cost, markupPercent = 12, rounding = 100) {
  const c = Number(cost);
  if (!Number.isFinite(c) || c < 0) throw new Error('cost tidak valid');
  const m = Number(markupPercent);
  const markup = Number.isFinite(m) && m > 0 ? m : 0;
  const r = Number(rounding);
  const step = Number.isFinite(r) && r > 0 ? r : 1;
  // Hitung dengan pembilang bulat (cost * (100 + markup)) supaya kelipatan
  // pas tidak meleset karena galat floating-point, mis. 17500 * 1.12 yang
  // dalam float = 19600.000000000004. Epsilon kecil menjaga batas kelipatan.
  const raw = (c * (100 + markup)) / 100;
  return Math.ceil((raw - 1e-9) / step) * step;
}

module.exports = { sellPrice };
