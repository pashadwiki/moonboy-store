# MoonBoy Store 🌙

Toko top up game berbasis web (mobile-first) untuk MoonBoy Store, terhubung ke
**Melo H2H API**. Ditulis dengan Node.js murni — **tanpa dependensi npm sama
sekali** (hanya modul bawaan `node:http`, `node:crypto`, `node:fs`, `node:path`,
plus `fetch` bawaan Node ≥ 20), jadi bisa jalan di hampir semua host Node.

## Cara menjalankan

```bash
node server.js
# atau
PORT=8080 node server.js
```

Lalu buka:

- Toko: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin`

## Menghubungkan akun Melo (halaman /admin)

1. Buka `/admin`, masuk dengan PIN admin (bawaan pabrik: **`123456`** —
   **WAJIB diganti** lewat kolom "PIN baru" saat pertama kali menyimpan).
2. Dari dashboard Melo H2H (menu **API Credentials** → *Rotate Keys*), tempel:
   - **API Key**
   - **Secret Key**
   - **Webhook Secret**
3. Atur **markup (%)** dan **pembulatan harga**, lalu Simpan.

Catatan penting:

- Kunci disimpan di `config.json` **di server** dan **tidak pernah** dikirim
  atau ditampilkan kembali ke browser. Halaman admin hanya menunjukkan status
  "sudah terisi / belum diisi".
- Kolom kunci yang dikosongkan saat menyimpan **tidak** menimpa nilai lama.
- Selama kunci belum diisi, toko berjalan dalam **mode demo**: katalog contoh
  MLBB + Free Fire tampil dengan label demo, dan tombol beli menjawab
  "toko belum aktif".

## Webhook Melo

Di dashboard Melo, isi **Webhook URL** dengan:

```
https://<domain-toko-kamu>/webhook
```

Server memverifikasi header `X-H2H-Signature` (hex HMAC-SHA256 dari raw body
dengan Webhook Secret) sebelum memproses callback hasil akhir pesanan.
Pengiriman ulang callback yang sama aman (dedup berdasarkan `id:status`).

## Sandbox vs Production

- **Sandbox** (`sandbox: true`, bawaan): pesanan dikirim dengan
  `sandbox_mode=true` — Melo mensimulasikan proses, riwayat, dan callback
  **tanpa memotong saldo dan tanpa uang asli**. Cocok untuk uji coba.
- **Production**: matikan mode sandbox di `/admin`. Syarat dari sisi Melo
  sebelum pesanan live bisa jalan:
  1. Akun H2H diaktifkan ke mode produksi di dashboard Melo.
  2. **IP publik server/host toko didaftarkan di IP Whitelist** dashboard Melo
     (kalau tidak, Melo menjawab HTTP 403).
  3. **Deposit saldo H2H** secukupnya — pesanan live memotong saldo ini.
     Pesanan yang gagal otomatis di-refund penuh oleh Melo.

## Harga jual

```
harga_jual = bulatkan_ke_atas( modal × (1 + markup%/100), kelipatan pembulatan )
```

Bawaan: markup 12%, pembulatan Rp100. Contoh: modal 1.048 → **Rp1.200**;
modal 1.597 → **Rp1.800**. Harga modal dari Melo **tidak pernah** ditampilkan
ke pengunjung; yang tampil hanya harga jual.

## Struktur berkas

```
server.js            Server HTTP + seluruh endpoint API toko
lib/pricing.js       Rumus harga jual (fungsi murni)
lib/config.js        Muat/simpan config.json
lib/melo.js          Klien API Melo H2H (auth header, timeout)
lib/orders.js        Penyimpanan pesanan di data/orders.json
lib/webhook.js       Verifikasi tanda tangan HMAC webhook
lib/payload.js       Pembentuk body POST /transaction + buyer_trx_id
lib/demo.js          Katalog demo (saat kunci belum diisi)
public/              Frontend statis (index, brand, order, admin)
test/                Test otomatis (node --test)
config.example.json  Contoh konfigurasi
config.json          Konfigurasi aktif (JANGAN dibagikan / di-commit)
data/orders.json     Data pesanan (dibuat otomatis)
```

## Test

```bash
npm test
```

Mencakup: rumus harga, verifikasi HMAC webhook (vektor yang diketahui +
body diubah), pembentuk payload pesanan, dan test end-to-end melawan stub
server Melo lokal (katalog 2 halaman → buat pesanan → webhook sukses →
status akhir).

## Deploy

Cocok di host Node generik mana pun (VPS, Render, Railway, Fly.io, dll):

1. Salin seluruh folder proyek ke host.
2. Jalankan `node server.js` dengan `PORT` dari environment host.
3. Pastikan folder `data/` bisa ditulis (di sana pesanan disimpan) dan
   `config.json` terisi (atau isi lewat `/admin` setelah jalan).
4. Daftarkan IP publik host ke IP Whitelist Melo + isi Webhook URL.
5. Taruh di balik HTTPS (reverse proxy / fitur bawaan platform) karena
   webhook Melo dan halaman admin sebaiknya hanya lewat HTTPS.

Variabel environment opsional: `PORT`, `MOONBOY_CONFIG` (lokasi config),
`MOONBOY_DATA_DIR` (lokasi data), `MELO_BASE_URL` (override alamat API Melo).
