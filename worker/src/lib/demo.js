// Katalog DEMO — ditampilkan HANYA saat kunci API Melo belum diisi,
// supaya pemilik bisa melihat tampilan toko. Harga modal di sini contoh.
// Disalin apa adanya dari versi Node (lib/demo.js).
const MLBB_FORM = {
  key: 'demo-mlbb-form',
  fields: [
    { key: 'customer_target', name: 'User ID', type: 'text' },
    { key: 'customer_target_zone', name: 'Zone ID', type: 'text' },
  ],
  notice: 'Contoh: User ID 12345678, Zone ID 1234. Lihat di profil Mobile Legends kamu.',
};

const FF_FORM = {
  key: 'demo-ff-form',
  fields: [{ key: 'customer_target', name: 'Player ID', type: 'text' }],
  notice: 'Player ID bisa dilihat di profil Free Fire kamu.',
};

export const BRANDS = [
  { brand_id: 'demo-mlbb', name: 'Mobile Legends', slug: 'mobile-legends', category: 'Games', types: ['Diamonds', 'Pass'] },
  { brand_id: 'demo-ff', name: 'Free Fire', slug: 'free-fire', category: 'Games', types: ['Diamonds'] },
];

export const PRODUCTS = {
  'demo-mlbb': {
    brand: { brand_id: 'demo-mlbb', name: 'Mobile Legends' },
    items: [
      { sku_code: 'DEMO-MLBB-3', name: '3 Diamonds', type_name: 'Diamonds', cost: 1048, form: MLBB_FORM },
      { sku_code: 'DEMO-MLBB-5', name: '5 Diamonds', type_name: 'Diamonds', cost: 1597, form: MLBB_FORM },
      { sku_code: 'DEMO-MLBB-86', name: '86 Diamonds', type_name: 'Diamonds', cost: 17500, form: MLBB_FORM },
      { sku_code: 'DEMO-MLBB-172', name: '172 Diamonds', type_name: 'Diamonds', cost: 34900, form: MLBB_FORM },
      { sku_code: 'DEMO-MLBB-WDP', name: 'Weekly Diamond Pass', type_name: 'Pass', cost: 24500, form: MLBB_FORM },
    ],
  },
  'demo-ff': {
    brand: { brand_id: 'demo-ff', name: 'Free Fire' },
    items: [
      { sku_code: 'DEMO-FF-5', name: '5 Diamonds', type_name: 'Diamonds', cost: 900, form: FF_FORM },
      { sku_code: 'DEMO-FF-50', name: '50 Diamonds', type_name: 'Diamonds', cost: 6300, form: FF_FORM },
      { sku_code: 'DEMO-FF-70', name: '70 Diamonds', type_name: 'Diamonds', cost: 8800, form: FF_FORM },
      { sku_code: 'DEMO-FF-140', name: '140 Diamonds', type_name: 'Diamonds', cost: 17600, form: FF_FORM },
    ],
  },
};
