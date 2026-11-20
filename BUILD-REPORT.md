# BUILD-REPORT — MoonBoy Store v1

Tanggal build: 20 November 2026. Lokasi: `~/workspace/moonboy-store/`.
Runtime: Node v24.22.1, **nol dependensi npm** (hanya modul bawaan Node).

## Ringkasan

Toko top up web mobile-first bernama "MoonBoy Store" yang berbicara ke Melo
H2H API (`https://api.melostore.id/api/v1/h2h`): katalog brand & produk
(di-cache 5 menit, mengikuti pagination cursor, hanya produk `active`),
cek nickname, pembuatan pesanan reguler dengan `buyer_trx_id` unik,
pelacakan status (polling + webhook bertanda tangan HMAC), halaman admin
ber-PIN untuk mengisi kunci API tanpa pernah menampilkannya kembali, dan
mode demo penuh saat kunci belum diisi.

## Berkas yang dibuat

| Berkas | Isi |
| --- | --- |
| `server.js` | Server `node:http`: frontend statis + API (`/api/brands`, `/api/products`, `/api/nickname-games`, `/api/check-nickname`, `/api/order`, `/api/order/:id`, `/webhook`, `/api/admin/status`, `/api/admin/config`, `/admin`) |
| `lib/pricing.js` | `sellPrice(cost, markup%, rounding)` — fungsi murni |
| `lib/config.js` | Muat/simpan `config.json`, `hasKeys()` |
| `lib/melo.js` | Klien Melo: header `X-API-Key`/`X-Secret-Key`/`Accept`, timeout 15 dtk |
| `lib/orders.js` | Store pesanan persisten `data/orders.json` (tulis atomik tmp+rename) |
| `lib/webhook.js` | `computeSignature`/`verifySignature` HMAC-SHA256 + `timingSafeEqual` |
| `lib/payload.js` | `buildTransactionBody` + `newBuyerTrxId` (`MB-…`, ≤64 char) |
| `lib/demo.js` | Katalog demo MLBB (3/5/86/172 💎 + Weekly Pass) & FF (5/50/70/140 💎) |
| `public/index.html` | Beranda: grid brand |
| `public/brand.html` | Daftar nominal + form ID/zone dinamis dari inquiry form + cek nickname live + tombol beli |
| `public/order.html` | Status pesanan, polling 5 detik sampai final |
| `public/admin.html` | Login PIN + form kunci/mode/markup |
| `public/style.css` | Tema gelap mobile-first, tanpa aset eksternal |
| `config.json` / `config.example.json` | Kunci kosong, sandbox `true`, markup 12, rounding 100, PIN `123456` |
| `.gitignore` | `config.json`, `data/`, `node_modules/` |
| `package.json` | `npm start`, `npm test` |
| `test/pricing.test.js` | 9 test rumus harga |
| `test/webhook.test.js` | 6 test HMAC (vektor diketahui + tamper) |
| `test/payload.test.js` | 5 test payload & buyer_trx_id |
| `test/e2e.test.js` | 6 test end-to-end vs stub Melo lokal |
| `README.md` | Cara jalan, admin, sandbox vs production, deploy |

## Hasil test

`npm test` (node --test) — **26 test, 26 lulus, 0 gagal** (durasi ±0,5 dtk):

```
✔ e2e: brands dari stub Melo
✔ e2e: products menggabungkan 2 halaman, hanya yang active, harga jual terhitung, modal tidak bocor
✔ e2e: check-nickname ketemu dan tidak ketemu
✔ e2e: alur pesanan lengkap — buat, processing, webhook sukses, status akhir success
✔ e2e: admin — PIN salah ditolak, status tidak membocorkan kunci
✔ e2e: halaman statis terlayani
✔ buildTransactionBody membentuk payload sesuai dokumentasi Melo
✔ zone kosong tidak dikirim
✔ additional_data kosong tidak dikirim, terisi dikirim apa adanya
✔ sandbox_mode mengikuti config
✔ newBuyerTrxId: format MB-, unik, maksimal 64 karakter
✔ cost 1048, markup 12%, rounding 100 -> 1200
✔ cost 1597, markup 12%, rounding 100 -> 1800
✔ argumen default = markup 12, rounding 100
✔ tanpa markup, harga pas kelipatan tetap
✔ tanpa markup, harga bukan kelipatan dibulatkan ke atas
✔ rounding 1 membulatkan ke rupiah terdekat ke atas
✔ cost sangat kecil tetap minimal satu kelipatan rounding
✔ rounding 500
✔ cost tidak valid melempar error
✔ computeSignature cocok dengan vektor HMAC yang diketahui
✔ verifySignature menerima signature yang benar
✔ verifySignature menolak body yang diubah (tampered)
✔ verifySignature menolak secret yang salah
✔ verifySignature menolak signature kosong / secret kosong
✔ verifySignature menolak signature dengan panjang berbeda
ℹ tests 26 · pass 26 · fail 0
```

Smoke test manual mode demo (config bawaan, tanpa kunci) juga lulus:
`/api/brands` → demo MLBB+FF; `/api/products?brand_id=demo-mlbb` → harga jual
1200/1800/19600/39100/27500; `POST /api/order` → HTTP 503 dengan pesan
Indonesia "Toko belum aktif…"; `/` dan `/admin` → HTTP 200.

## Bug yang ditemukan & diperbaiki selama build

Rumus harga awal memakai float `cost * 1.12`: untuk modal 17.500 hasilnya
`19600.000000000004`, sehingga pembulatan ke atas menghasilkan 19.700
(seharusnya 19.600). Diperbaiki dengan menghitung pembilang bulat
`cost * (100 + markup)` + epsilon kecil sebelum `ceil`. Test e2e menangkap
kasus ini dan sekarang lulus.

## Keputusan atas ambiguitas dokumentasi

1. **Cek nickname**: brief awal menyebut "check-nickname plan endpoint
   (no auth)". Dokumentasi resmi menunjukkan `GET /check-nickname/plan` hanya
   berisi kuota/tarif (publik), sedangkan pemeriksaan nama yang sebenarnya
   adalah **`POST /check-nickname` dan WAJIB header auth**
   (`X-API-Key` + `X-Secret-Key`), body `{game_code, customer_target,
   customer_target_zone?}`, respons `data.username`, HTTP 404 = tidak
   ditemukan. Implementasi mengikuti dokumentasi: server mem-proxy
   `POST /check-nickname` dengan kunci dari config (tidak pernah ke browser);
   tanpa kunci → 503 "toko belum aktif". Endpoint tambahan
   `GET /api/nickname-games` mem-proxy `GET /check-nickname/games` (publik)
   agar halaman brand bisa mencocokkan brand → `game_code`.
2. **Bentuk daftar game**: respons `/check-nickname/games` memakai field
   tingkat-atas `games[]` (bukan `data[]`) — ditangani sesuai contoh docs.
3. **`fulfilled_sku_code`**: menurut docs hanya callback Smart/bulk yang
   menambahkannya; callback reguler tidak. Kode menyimpannya bila ada, tidak
   mengandalkannya untuk reguler.
4. **Harga pada status**: `GET /transaction/{id}` memakai field `price`,
   callback memakai `price_charged`; keduanya disimpan terpisah
   (`cost` vs `price_charged`).
5. **Event `transaction.action_change`**: dicatat di `action_events` dan
   tidak pernah menyelesaikan pesanan, sesuai peringatan docs.
6. **Hasil create yang belum pasti** (timeout/5xx setelah 1× retry dengan
   `buyer_trx_id` yang sama, sesuai docs): server menjawab 202 dengan
   `buyer_trx_id`; halaman status memastikan hasil akhir lewat
   `GET /transaction/{buyer_trx_id}`.
7. **Harga jual saat SKU belum ada di cache katalog**: pesanan tetap dibuat;
   harga jual dihitung dari `price` pada respons create Melo.
8. **PIN admin bawaan `123456`** hanyalah placeholder — README dan halaman
   admin memperingatkan untuk menggantinya; admin bisa mengganti PIN dari
   halaman yang sama.

## Yang TIDAK dilakukan (sesuai batas tugas)

- Tidak di-deploy ke mana pun; semua tetap di `~/workspace/moonboy-store/`.
- Tidak membuat akun/kunci Melo asli; test memakai stub lokal.
- Tidak ada commit/push ke remote git mana pun.
- `data/orders.json` belum dibuat (terbentuk otomatis saat pesanan pertama
  atau saat server jalan dengan data dir terpisah saat pengujian).
