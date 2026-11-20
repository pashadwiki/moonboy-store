'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Penyimpanan pesanan sederhana di data/orders.json (array of order records).
function dataDir() {
  return process.env.MOONBOY_DATA_DIR || path.join(__dirname, '..', 'data');
}

function ordersFile() {
  return path.join(dataDir(), 'orders.json');
}

function createOrderStore() {
  let orders;
  try {
    const parsed = JSON.parse(fs.readFileSync(ordersFile(), 'utf8'));
    orders = Array.isArray(parsed) ? parsed : [];
  } catch {
    orders = [];
  }

  function persist() {
    fs.mkdirSync(dataDir(), { recursive: true });
    const target = ordersFile();
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(orders, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, target);
  }

  return {
    all: () => orders.slice(),
    get(buyerTrxId) {
      return orders.find((o) => o.buyer_trx_id === buyerTrxId) || null;
    },
    getByMeloId(meloId) {
      if (!meloId) return null;
      return orders.find((o) => o.melo_id === meloId) || null;
    },
    upsert(order) {
      const idx = orders.findIndex((o) => o.buyer_trx_id === order.buyer_trx_id);
      if (idx >= 0) orders[idx] = order;
      else orders.push(order);
      persist();
      return order;
    },
  };
}

module.exports = { createOrderStore, dataDir, ordersFile };
