# DEPLOY — MoonBoy Store (Cloudflare Workers)

Panduan memasang versi Workers dari MoonBoy Store sampai online.
Ada dua jalur: **(A) Dashboard Cloudflare + Git** (tanpa install apa pun,
semua dari browser) dan **(B) wrangler CLI**. Hasil akhirnya sama.

Struktur yang di-deploy adalah folder `worker/` ini:

```
worker/
  wrangler.toml      konfigurasi Worker, assets, KV, vars
  src/worker.js      entry point (semua endpoint /api/*, /webhook, /admin)
  src/lib/*.js       modul logika (harga, payload, webhook, config, melo, orders, cache)
  public/            frontend statis (index, brand, order, admin, style.css)
  test/              harness test (node --test) — tidak ikut ter-deploy
```

---

## Persiapan (kedua jalur sama)

1. **Buat akun Cloudflare** (bila belum punya): buka
   https://dash.cloudflare.com/sign-up → daftar dengan email → verifikasi
   email. Gratis, tanpa kartu kredit.
2. **Buat 2 KV namespace**: di dashboard Cloudflare pilih
   **Storage & Databases → KV → Create namespace**, buat dua:
   - `ORDERS`
   - `SETTINGS`

   Catat **ID** masing-masing namespace (muncul di daftar KV).
3. **Tempel ID KV ke `wrangler.toml`** di folder `worker/`, ganti dua baris
   placeholder ini:

   ```toml
   [[kv_namespaces]]
   binding = "ORDERS"
   id = "GANTI_DENGAN_ID_KV_ORDERS"      # <- ganti dengan ID asli

   [[kv_namespaces]]
   binding = "SETTINGS"
   id = "GANTI_DENGAN_ID_KV_SETTINGS"   # <- ganti dengan ID asli
   ```

   Simpan/commit perubahan itu sebelum deploy.

---

## Jalur A — Dashboard Cloudflare (Connect to Git)

Cocok karena kode toko sudah ada di GitHub (`pashadwiki/moonboy-store`,
folder `worker/` di dalamnya).

1. Buka https://dash.cloudflare.com → **Workers & Pages** → **Create** →
   **Workers** → **Connect to Git**.
2. Hubungkan akun GitHub bila diminta, lalu pilih repository
   **`moonboy-store`**.
3. Isi pengaturan build:
   - **Project name**: `moonboy-store`
   - **Production branch**: `main`
   - **Root directory**: `worker`
   - **Build command**: kosongkan
   - **Deploy command**: `npx wrangler deploy`
4. Klik **Deploy**. Tunggu sampai build selesai; Cloudflare memberi alamat
   seperti `https://moonboy-store.<subdomain-kamu>.workers.dev`.
5. Lanjut ke bagian **Setelah deploy** di bawah.

> Catatan: mengedit kode langsung di editor web dashboard tidak cocok untuk
> proyek multi-berkas + static assets seperti ini; jalur Git di atas adalah
> jalur dashboard yang benar. Alternatif tanpa Git: pakai Jalur B.

## Jalur B — wrangler CLI

Dari komputer mana pun (Node.js ≥ 20 terpasang):

```bash
cd worker

# 1. Login ke Cloudflare (membuka browser)
npx wrangler login

# 2. (Bila belum) buat KV namespace — perintah ini mencetak id-nya;
#    tempel ke wrangler.toml seperti langkah Persiapan no. 3.
npx wrangler kv namespace create ORDERS
npx wrangler kv namespace create SETTINGS

# 3. (Opsional tapi disarankan) pasang rahasia sebagai Worker secrets.
#    Bila langkah ini dilewati, kunci Melo bisa ditempel lewat halaman
#    /admin toko setelah deploy (tersimpan di KV SETTINGS).
npx wrangler secret put MELO_API_KEY
npx wrangler secret put MELO_SECRET_KEY
npx wrangler secret put MELO_WEBHOOK_SECRET
npx wrangler secret put ADMIN_PIN

# 4. Deploy
npx wrangler deploy
```

Wrangler mencetak alamat `https://moonboy-store.<subdomain-kamu>.workers.dev`
setelah deploy berhasil.

---

## Setelah deploy (kedua jalur)

1. **Buka halaman admin toko**: `https://<alamat-worker>/admin`
   - Masuk dengan PIN bawaan **`123456`** — **WAJIB langsung diganti**
     lewat kolom "PIN baru" saat pertama kali menyimpan pengaturan.
   - Bila kunci Melo belum dipasang sebagai secrets (Jalur B langkah 3),
     tempel **API Key**, **Secret Key**, dan **Webhook Secret** dari
     dashboard Melo (menu **API Credentials → Rotate Keys**) di halaman ini.
     Kunci tersimpan di KV SETTINGS dan tidak pernah ditampilkan kembali.
   - Pastikan **Mode sandbox** masih **AKTIF** untuk pengujian.
2. **Daftarkan Webhook URL di dashboard Melo** (menu API Credentials →
   Webhook Endpoint):

   ```
   https://<alamat-worker>/webhook
   ```

   Webhook Secret di Melo harus sama dengan yang terpasang di toko
   (keduanya berasal dari Rotate Keys yang sama).
3. **Uji alur sandbox**: buka alamat toko → pilih Mobile Legends →
   pilih nominal → isi ID contoh → Beli. Pesanan sandbox disimulasikan
   Melo tanpa memotong saldo. Status pesanan harus bergerak
   `processing → success` di halaman status.
4. Selesai — toko online dalam mode sandbox.

### Variabel & rahasia yang dikenal Worker

| Nama | Jenis | Bawaan | Keterangan |
| --- | --- | --- | --- |
| `MELO_API_KEY` | secret | — | Kunci API Melo (atau isi via /admin) |
| `MELO_SECRET_KEY` | secret | — | Secret Key Melo (atau via /admin) |
| `MELO_WEBHOOK_SECRET` | secret | — | Webhook Secret Melo (atau via /admin) |
| `ADMIN_PIN` | secret | `123456` | PIN halaman /admin — **ganti!** |
| `SANDBOX` | var | `"true"` | `"true"`/`"false"`; bisa ditimpa dari /admin |
| `MARKUP_PERCENT` | var | `"12"` | Markup harga jual; bisa ditimpa dari /admin |
| `ROUNDING` | var | `"100"` | Pembulatan harga (Rp); bisa ditimpa dari /admin |
| `MELO_BASE_URL` | var | API produksi Melo | Hanya untuk pengujian |

Pengaturan yang disimpan lewat /admin (KV SETTINGS) **selalu menimpa**
variabel/secrets di atas.

---

## ⚠️ Peringatan produksi (baca sebelum mematikan sandbox)

1. **IP Whitelist Melo**: untuk pesanan **live** (bukan sandbox), Melo
   dapat mewajibkan IP publik server toko terdaftar di **IP Whitelist**
   dashboard Melo — tanpa itu Melo menjawab **HTTP 403**. Cloudflare
   Workers berjalan di infrastruktur bersama Cloudflare dengan rentang IP
   egress bersama yang **tidak bisa di-whitelist per-pengguna**, jadi
   pesanan live dari Workers **mungkin ditolak Melo**. Ini keterbatasan
   platform yang diketahui sejak awal:
   - Tetaplah di **mode sandbox** dulu (semua alur berfungsi penuh).
   - Sebelum go-live, tanyakan ke support Melo apakah H2H production bisa
     berjalan tanpa IP whitelist / dari Cloudflare Workers. Bila tidak,
     jalur produksi yang aman tetap versi Node di host ber-IP statis.
2. **KV eventually consistent**: pesanan yang baru ditulis bisa butuh
   beberapa detik untuk terbaca seragam di semua lokasi. Alur normal toko
   (pembeli polling status pesanannya sendiri) tidak terpengaruh berarti.
3. **Kuota gratis Cloudflare**: Workers free tier ±100.000 request/hari
   dan KV punya kuota baca/tulis harian — jauh di atas kebutuhan toko
   skala awal, tapi pantau di dashboard bila trafik naik.
4. **Jangan pernah** membagikan PIN admin, API Key, Secret Key, atau
   Webhook Secret ke siapa pun; halaman /admin hanya menampilkan status
   terisi/belum, bukan nilainya.
