// check-scheduler.cjs
// Este script roda no GitHub Actions antes de iniciar a atualização de capítulos.
// Ele verifica no banco Neon (PostgreSQL) se o agendador está habilitado, qual o intervalo,
// e se já passou tempo suficiente desde a última execução.

const fs = require('fs');
const path = require('path');
const { createPool } = require('@vercel/postgres');

// Lê os tetos por scraper (cap_<provider>) do banco e aplica no scraper-config.json
// desta checkout antes dos scrapers rodarem. O arquivo não é commitado pelo
// workflow — é regenerado do banco a cada execução (o painel é a fonte de verdade).
async function syncScraperConfig(client) {
  try {
    const res = await client.query("SELECT key, value FROM site_settings WHERE key LIKE 'cap_%'");
    const rows = res.rows || [];
    if (!rows.length) return;
    const cfgPath = path.join(__dirname, 'scraper-config.json');
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {}
    let changed = false;
    for (const row of rows) {
      const key = row.key.replace(/^cap_/, '');
      const v = parseInt(row.value, 10);
      if (!isNaN(v) && v >= 0 && cfg[key] !== v) { cfg[key] = v; changed = true; }
    }
    if (changed) {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
      console.log('⚙️ scraper-config.json atualizado a partir do painel (tetos por scraper).');
    }
  } catch (e) {
    console.error('Falha ao sincronizar scraper-config.json:', e.message);
  }
}

async function run() {
  const isDispatch = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const dbUrl = process.env.DATABASE_URL;

  if (isDispatch) {
    console.log('⚡ Disparado manualmente via botão. Executando atualizador imediatamente.');
    fs.appendFileSync(process.env.GITHUB_ENV, 'SHOULD_RUN=true\n');
    
    if (dbUrl) {
      const client = createPool({ connectionString: dbUrl });
      try {
        const now = Date.now();
        await Promise.all([
          client.query("INSERT INTO site_settings (key, value) VALUES ('scheduler_last_run', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(now)]),
          client.query("INSERT INTO site_settings (key, value) VALUES ('scheduler_last_status', 'running') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        ]);
        await syncScraperConfig(client);
        console.log('Banco de dados atualizado para início manual.');
        await client.end();
      } catch (err) {
        console.error('Erro ao atualizar banco no disparo manual:', err.message);
      }
    }
    process.exit(0);
  }

  if (!dbUrl) {
    console.error('Erro: DATABASE_URL não configurado nas secrets do GitHub.');
    // Fallback: executa para garantir
    fs.appendFileSync(process.env.GITHUB_ENV, 'SHOULD_RUN=true\n');
    process.exit(0);
  }

  const client = createPool({ connectionString: dbUrl });
  try {
    await client.query("SELECT 1");
  } catch (err) {
    console.error('Erro de conexão ao banco de dados:', err.message);
    // Em caso de erro do banco, rodamos a atualização para não travar o site
    fs.appendFileSync(process.env.GITHUB_ENV, 'SHOULD_RUN=true\n');
    process.exit(0);
  }

  let rows = [];
  try {
    const res = await client.query("SELECT key, value FROM site_settings WHERE key LIKE 'scheduler_%'");
    rows = res.rows || [];
  } catch (err) {
    console.log('Tabela site_settings não existe ou falhou. Rodando atualizador como fallback...');
    fs.appendFileSync(process.env.GITHUB_ENV, 'SHOULD_RUN=true\n');
    await client.end();
    process.exit(0);
  }

  const settings = {};
  rows.forEach(row => {
    settings[row.key] = row.value;
  });

  const enabled = settings['scheduler_enabled'] === 'true';
  const intervalStr = settings['scheduler_interval'] || '12h';
  const lastRunStr = settings['scheduler_last_run'] || '0';
  const targetLang = settings['scheduler_lang'] || 'all';
  const targetMode = settings['scheduler_mode'] || 'incremental';

  if (!enabled) {
    console.log('⚪ Agendador automático desativado via painel de administração.');
    fs.appendFileSync(process.env.GITHUB_ENV, 'SHOULD_RUN=false\n');
    await client.end();
    process.exit(0);
  }

  const lastRun = parseInt(lastRunStr, 10);
  const now = Date.now();

  let intervalMs = 12 * 60 * 60 * 1000; // 12h padrão
  const num = parseInt(intervalStr, 10);
  if (!isNaN(num)) {
    if (intervalStr.endsWith('h')) intervalMs = num * 60 * 60 * 1000;
    else if (intervalStr.endsWith('d')) intervalMs = num * 24 * 60 * 60 * 1000;
    else if (intervalStr.endsWith('m')) intervalMs = num * 60 * 1000;
  }

  const timePassed = now - lastRun;
  if (timePassed >= intervalMs) {
    console.log(`🟢 Tempo transcorrido (${Math.round(timePassed / 60000)}m) >= Intervalo (${Math.round(intervalMs / 60000)}m). Executando scraper...`);
    
    // Atualiza a data e status da última execução
    await Promise.all([
      client.query("INSERT INTO site_settings (key, value) VALUES ('scheduler_last_run', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(now)]),
      client.query("INSERT INTO site_settings (key, value) VALUES ('scheduler_last_status', 'running') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
    ]);
    await syncScraperConfig(client);

    fs.appendFileSync(process.env.GITHUB_ENV, 'SHOULD_RUN=true\n');
    fs.appendFileSync(process.env.GITHUB_ENV, `SCRAPE_LANG=${targetLang}\n`);
    fs.appendFileSync(process.env.GITHUB_ENV, `SCRAPE_MODE=${targetMode}\n`);
  } else {
    console.log(`⏱️ Ainda não é hora de rodar. Última execução: ${new Date(lastRun).toLocaleString('pt-BR')} (A cada ${intervalStr})`);
    fs.appendFileSync(process.env.GITHUB_ENV, 'SHOULD_RUN=false\n');
  }

  await client.end();
}

run();
