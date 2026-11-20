'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  apiKey: '',
  secretKey: '',
  webhookSecret: '',
  sandbox: true,
  markupPercent: 12,
  rounding: 100,
  adminPin: '123456',
  meloBaseUrl: 'https://api.melostore.id/api/v1/h2h',
};

function configPath() {
  return process.env.MOONBOY_CONFIG || path.join(__dirname, '..', 'config.json');
}

function loadConfig() {
  let cfg = { ...DEFAULTS };
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') cfg = { ...cfg, ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (process.env.MELO_BASE_URL) cfg.meloBaseUrl = process.env.MELO_BASE_URL;
  return cfg;
}

function saveConfig(cfg) {
  const target = configPath();
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, target);
}

function hasKeys(cfg) {
  return Boolean(cfg && cfg.apiKey && cfg.secretKey);
}

module.exports = { DEFAULTS, configPath, loadConfig, saveConfig, hasKeys };
