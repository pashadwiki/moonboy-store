# REPORT — Port MoonBoy Store ke Cloudflare Workers

Tanggal port: 20 November 2026. Sumber (tidak diubah sama sekali):
`~/workspace/moonboy-store/` versi Node. Hasil port:
`~/workspace/moonboy-store/worker/`. **Tidak ada deploy, tidak ada akun
Cloudflare yang dibuat, tidak ada push ke GitHub** — sesuai batas tugas.

## Ringkasan

Seluruh perilaku versi Node dipindahkan ke Cloudflare Workers dengan
perubahan hanya pada hal yang memang berbeda platform: penyimpanan
config (file → env + KV), penyimpanan pesanan (file JSON → KV),
verifikasi HMAC (sinkron → WebCrypto asinkron), pembuatan ID acak
(`crypto.randomBytes` → `crypto.getRandomValues`), dan penyajian berkas
statis (filesystem → Workers static assets). Logika bisnis — rumus harga,
payload transaksi, alur retry, dedupe webhook, semantik admin — disalin
persis, termasuk seluruh kasus test versi Node.

**Hasil test: 52 test, 52 lulus, 0 gagal** (`npm test`, node --test,
Node v24.22.1, nol dependensi npm). Rincian lengkap di bawah.

## Berkas yang dibuat

| Berkas | Isi |
| --- | --- |
| `src/worker.js` | Entry point Worker: router + seluruh handler (port `server.js`) |
| `src/lib/pricing.js` | Rumus harga jual — logika identik versi Node |
| `src/lib/payload.js` | `buildTransactionBody` + `newBuyerTrxId` (WebCrypto) |
| `src/lib/webhook.js` | `computeSignature`/`verifySignature` HMAC-SHA256 via `crypto.subtle` (async) |
| `src/lib/config.js` | Resolusi config: DEFAULTS < env vars/secrets < KV SETTINGS |
| `src/lib/melo.js` | Klien Melo H2H (fetch global, header auth, timeout 15 dtk) |
| `src/lib/orders.js` | Store pesanan di KV ORDERS + indeks `by-melo:<id>` |
| `src/lib/cache.js` | Cache katalog 5 menit: Map memori isolate + Cache API (best-effort) |
| `src/lib/demo.js` | Katalog demo — data disalin apa adanya |
| `public/` | Frontend versi Node, **byte-identical** (terverifikasi `diff -r`) |
| `wrangler.toml` | name `moonboy-store`, `[assets]` + binding ASSETS + `run_worker_first`, placeholder KV ORDERS/SETTINGS, `[vars]` bawaan |
| `package.json` | ESM (`"type": "module"`), script test/deploy/dev |
| `test/mocks.js` | MockKV, stub Melo sebagai pengganti global fetch, mock ASSETS dari disk |
| `test/pricing.test.js` | 10 test (9 kasus Node + regresi float eksplisit) |
| `test/webhook.test.js` | 8 test HMAC (vektor diketahui + normalisasi + tamper) |
| `test/payload.test.js` | 5 test (sama dengan versi Node) |
| `test/e2e.test.js` | 10 test alur penuh melawan stub Melo |
| `test/retry.test.js` | 3 test retry create (5xx → retry ID sama; 5xx total → 202; 4xx → failed tanpa retry) |
| `test/demo.test.js` | 7 test mode demo tanpa kunci |
| `test/admin.test.js` | 8 test admin/KV (PIN, persistensi, markup, ganti PIN) |
| `DEPLOY.md` | Langkah deploy jalur dashboard (Git) & wrangler CLI + peringatan produksi |

## Keputusan desain

1. **Static assets via `[assets]` + binding `ASSETS` + `run_worker_first = true`.**
   Worker selalu berjalan lebih dulu sehingga pemetaan `/` → `index.html`
   dan `/admin` → `admin.html` serta prioritas `/api/*` persis seperti
   `serveStatic` versi Node; berkas diambil lewat `env.ASSETS.fetch`.
   Frontend tidak diubah satu byte pun.
2. **`/api/check-nickname` melayani GET dan POST.** Frontend yang sudah
   ada memakai GET dengan query (`game_code`, `target`, `zone`) — itu
   dipertahankan apa adanya; POST (body JSON, menerima `target`/
   `customer_target` dan `zone`/`customer_target_zone`) ditambahkan
   sesuai spesifikasi port. Keduanya mem-proxy Melo `POST /check-nickname`
   **dengan header auth** (koreksi dokumentasi resmi di BUILD-REPORT
   versi Node: yang publik tanpa auth hanya `/check-nickname/games` dan
   `/check-nickname/plan`). Endpoint pendamping `GET /api/nickname-games`
   ikut diport karena frontend membutuhkannya.
3. **Config: env sebagai bawaan, KV SETTINGS sebagai penimpa.** Halaman
   /admin menulis satu objek JSON di key `settings` pada KV SETTINGS
   (apiKey, secretKey, webhookSecret, sandbox, markupPercent, rounding,
   adminPin). Resolusi per-request: DEFAULTS → env → KV. Semantik
   penyimpanan meniru versi Node persis: string kosong tidak menimpa
   kunci lama, markup dibatasi 0–1000, rounding ≥ 1, PIN baru ≥ 4 char.
   Kunci bersifat write-only: respons admin hanya memuat status
   terisi/belum (diuji: nilai kunci tidak muncul di JSON respons).
   Konsekuensi yang disadari: PIN yang diganti via /admin menimpa
   `ADMIN_PIN` env untuk seterusnya (diuji).
4. **Pesanan di KV ORDERS + indeks by-melo.** Key utama `buyer_trx_id`;
   karena KV tidak bisa mencari berdasarkan field, upsert juga menulis
   `by-melo:<melo_id> → buyer_trx_id` agar fallback pencocokan webhook
   versi Node (getByMeloId) tetap bekerja — dibuktikan test khusus.
   Catatan: KV eventually consistent; dicantumkan di DEPLOY.md.
5. **Cache katalog dua lapis.** Lapis memori isolate berperilaku identik
   dengan Map versi Node (dan itulah yang diverifikasi test dengan
   menghitung panggilan stub). Di atasnya, Cache API (`caches.default`)
   dipakai best-effort bila tersedia agar cache bertahan lintas isolate;
   kegagalannya tidak pernah menggagalkan request. `POST /api/admin/config`
   membersihkan cache seperti versi Node (diuji: ganti markup langsung
   mengubah harga).
6. **Webhook WebCrypto.** `verifySignature` kini async; raw body diambil
   dari `request.text()` lalu di-encode UTF-8 (body JSON Melo selalu
   UTF-8, jadi byte-nya identik dengan raw body versi Node). Perbandingan
   signature memakai akumulasi XOR constant-time setelah normalisasi
   trim+lowercase, meniru `timingSafeEqual`. Vektor HMAC yang sama dengan
   versi Node lulus persis (`f05964fb…442bc`).
7. **Indeks SKU tetap di memori isolate** seperti versi Node, termasuk
   fallback-nya: pesanan untuk SKU yang belum terindeks tetap dibuat dan
   harga jual dihitung dari `price` pada respons create Melo (diuji di
   test retry, di mana katalog tidak pernah dimuat).
8. **Batas body 1 MB** dipertahankan dari versi Node untuk
   order/admin/webhook.

## Hasil test lengkap

`npm test` (node --test test/*.test.js) — **tests 52 · pass 52 · fail 0**
(durasi ±0,9 dtk):

```
✔ admin: PIN salah ditolak di status dan config
✔ admin: status awal — kunci belum terisi, toko belum aktif
✔ admin: simpan kunci -> tersimpan di KV, aktif, nilai kunci tidak bocor
✔ admin: kunci dari KV berlaku juga untuk isolate/env baru (persisten)
✔ admin: ubah markup -> harga berubah & kunci kosong tidak menimpa kunci lama
✔ admin: matikan sandbox -> status mencerminkan & persisten di KV
✔ admin: ganti PIN -> PIN lama ditolak, PIN baru diterima
✔ admin: body JSON rusak -> 400
✔ demo: brands adalah katalog demo
✔ demo: products MLBB dengan harga jual contoh yang benar
✔ demo: products FF
✔ demo: brand tak dikenal -> 404; brand_id kosong -> 400
✔ demo: buat pesanan -> 503 toko belum aktif
✔ demo: cek nickname GET & POST -> 503
✔ demo: pesanan tidak valid -> 400 sebelum cek kunci
✔ e2e: brands dari stub Melo, panggilan kedua dari cache
✔ e2e: products menggabungkan 2 halaman, hanya yang active, harga jual terhitung, modal tidak bocor
✔ e2e: nickname-games dari stub Melo
✔ e2e: check-nickname GET ketemu dan tidak ketemu
✔ e2e: check-nickname POST ketemu (bentuk body JSON)
✔ e2e: alur pesanan lengkap — buat, processing, webhook, status akhir success
✔ e2e: webhook dicocokkan lewat id Melo bila buyer_trx_id asing (fallback by-melo)
✔ e2e: webhook untuk pesanan tak dikenal -> received, matched false
✔ e2e: webhook tanpa webhook secret terkonfigurasi ditolak 401
✔ e2e: pesanan tidak ditemukan -> 404; endpoint api tak dikenal -> 404
✔ e2e: halaman statis terlayani dari ASSETS
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
✔ regresi float: cost 17500, markup 12%, rounding 100 -> 19600 (bukan 19700)
✔ retry: create pertama 500, kedua berhasil dengan buyer_trx_id yang sama
✔ retry: semua percobaan 500 -> jawaban 202, pesanan tersimpan sebagai created
✔ create ditolak 4xx oleh Melo -> pesanan failed, tanpa retry
✔ computeSignature (WebCrypto) cocok dengan vektor HMAC yang diketahui
✔ computeSignature menerima Uint8Array sama seperti string
✔ verifySignature menerima signature yang benar
✔ verifySignature menerima signature huruf besar + spasi (dinormalisasi)
✔ verifySignature menolak body yang diubah (tampered)
✔ verifySignature menolak secret yang salah
✔ verifySignature menolak signature kosong / secret kosong
✔ verifySignature menolak signature dengan panjang berbeda
ℹ tests 52 · pass 52 · fail 0
```

Pemeriksaan tambahan di luar test suite:

- `wrangler.toml` ter-parse valid (python tomllib): name, `[assets]`
  (directory/binding/run_worker_first), dua `[[kv_namespaces]]`,
  `[vars]` SANDBOX/MARKUP_PERCENT/ROUNDING terbaca benar.
- Pindaian API khusus Node di `src/`: tidak ada `require`, `Buffer`,
  `process.env`, atau impor `node:` pada kode yang berjalan (satu-satunya
  kemunculan kata "node:crypto" adalah di komentar penjelasan port).
- `diff -r` antara `worker/public/` dan `public/` versi Node: identik.

## Temuan selama pengujian (transparansi)

- Satu kegagalan test awal (51/52) adalah **kesalahan pada test saya
  sendiri**, bukan pada kode Worker: test "pesanan tak dikenal" memakai
  ulang `id` Melo milik pesanan sebelumnya, sehingga pesanan memang
  *ditemukan* lewat fallback by-melo dan ter-dedupe — persis perilaku
  versi Node. Test diperbaiki (id yang benar-benar asing) dan ditambah
  test eksplisit untuk fallback by-melo. Tidak ada perubahan kode Worker
  yang diperlukan.
- Script test awal `node --test test/` gagal di Node v24.22.1 lingkungan
  ini (direktori diperlakukan sebagai modul); diganti glob eksplisit
  `node --test test/*.test.js` di `package.json`.

## Yang TIDAK diverifikasi (di luar jangkauan harness)

- **Runtime Cloudflare asli**: harness berjalan di Node dengan mock
  env/KV/fetch/ASSETS. Lapis Cache API hanya aktif di Cloudflare
  (best-effort, ter-guard) dan tidak terlatih di harness; lapis memori
  yang terverifikasi penuh. `wrangler deploy`/`wrangler dev` tidak
  dijalankan (di luar batas tugas: tanpa deploy & tanpa akun).
- **Melo production & IP whitelist**: seperti diperingatkan di DEPLOY.md,
  pesanan live Melo dapat mewajibkan IP whitelist yang tidak bisa
  dipenuhi egress bersama Workers. Ini keterbatasan platform yang
  dicatat, bukan diselesaikan — sandbox berfungsi penuh.
- **Kunci Melo asli**: tidak ada; semua test memakai stub.
