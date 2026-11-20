// Penyimpanan pesanan di KV binding ORDERS.
// Key utama = buyer_trx_id (nilai = JSON pesanan). Karena KV tidak punya
// pencarian berdasarkan field lain, dibuat indeks tambahan:
//   key "by-melo:<melo_id>" -> buyer_trx_id
// supaya getByMeloId (dipakai webhook) tetap bisa menemukan pesanan.
// Catatan: KV bersifat eventually consistent — pesanan yang baru ditulis
// mungkin butuh beberapa detik untuk terbaca dari lokasi lain. Alur toko
// (buat -> polling status oleh pembeli yang sama) tidak sensitif terhadap ini.
export function createOrderStore(kv) {
  return {
    async get(buyerTrxId) {
      if (!kv || !buyerTrxId) return null;
      const order = await kv.get(buyerTrxId, { type: 'json' });
      return order && typeof order === 'object' ? order : null;
    },
    async getByMeloId(meloId) {
      if (!kv || !meloId) return null;
      const buyerTrxId = await kv.get(`by-melo:${meloId}`);
      if (!buyerTrxId) return null;
      return this.get(buyerTrxId);
    },
    async upsert(order) {
      if (!kv) return order;
      await kv.put(order.buyer_trx_id, JSON.stringify(order));
      if (order.melo_id) {
        await kv.put(`by-melo:${order.melo_id}`, order.buyer_trx_id);
      }
      return order;
    },
  };
}
