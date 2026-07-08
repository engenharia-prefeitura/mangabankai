// scraper-config.cjs — loader compartilhado do teto de obras novas por scraper.
// Lê scraper-config.json (na raiz do projeto), editável pela aba Admin.
// Precedência de valor: variável de ambiente > arquivo de config > fallback embutido.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'scraper-config.json');

function loadScraperConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Teto para modo INCREMENTAL: env var (se definida e numérica) > config[key] > fallback.
// Obs.: quem chama decide o comportamento do modo --all (normalmente ignora o teto).
function getCap(key, envVar, fallback) {
  if (envVar && process.env[envVar] != null && process.env[envVar] !== '') {
    const v = parseInt(process.env[envVar], 10);
    if (!isNaN(v)) return v;
  }
  const cfg = loadScraperConfig();
  if (cfg[key] != null) {
    const v = parseInt(cfg[key], 10);
    if (!isNaN(v)) return v;
  }
  return fallback;
}

// Resolve o teto respeitando o modo full: em --all o env var ainda pode forçar um
// valor, mas o config file é ignorado (full = pega tudo, até `fullDefault`).
function resolveCap({ key, envVar, incrementalDefault, fullDefault, full }) {
  if (envVar && process.env[envVar] != null && process.env[envVar] !== '') {
    const v = parseInt(process.env[envVar], 10);
    if (!isNaN(v)) return v;
  }
  if (full) return fullDefault;
  return getCap(key, null, incrementalDefault);
}

module.exports = { loadScraperConfig, getCap, resolveCap, CONFIG_PATH };
