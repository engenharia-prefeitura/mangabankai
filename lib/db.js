const { sql } = require('@vercel/postgres');

let isInitialized = false;

async function initDB() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(10) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(10) DEFAULT 'user';`;
    await sql`
      CREATE TABLE IF NOT EXISTS manga_views (
        manga_id VARCHAR(100) PRIMARY KEY,
        count INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS favorites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        manga_id VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, manga_id)
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS hidden_manga (
        manga_id VARCHAR(100) PRIMARY KEY,
        hidden_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS site_settings (
        key VARCHAR(100) PRIMARY KEY,
        value VARCHAR(255) NOT NULL
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS reading_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        manga_id VARCHAR(100) NOT NULL,
        chapter_id VARCHAR(100) NOT NULL,
        page_index INTEGER NOT NULL,
        total_pages INTEGER NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, manga_id)
      );
    `;
    // Web Push: inscrições dos navegadores e estado p/ detectar capítulos novos.
    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS manga_notify_state (
        manga_id VARCHAR(100) PRIMARY KEY,
        last_count INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    // Liga a inscrição de push ao usuário logado (inscrições antigas ficam NULL).
    await sql`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_id INTEGER;`;
    // Telemetria de uso: 1 linha por visitante (anônimo ou logado) por dia.
    // O front acumula segundos localmente e manda 1 beacon ao sair da página,
    // então o volume de escrita fica baixo (importante no Neon free tier).
    await sql`
      CREATE TABLE IF NOT EXISTS usage_daily (
        anon_id VARCHAR(64) NOT NULL,
        date DATE NOT NULL,
        user_id INTEGER,
        seconds_total INTEGER DEFAULT 0,
        seconds_reading INTEGER DEFAULT 0,
        pages_read INTEGER DEFAULT 0,
        device VARCHAR(10),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (anon_id, date)
      );
    `;
    // Buscas que não retornaram nenhum resultado (guia o que adicionar ao catálogo).
    await sql`
      CREATE TABLE IF NOT EXISTS search_misses (
        query VARCHAR(120) PRIMARY KEY,
        count INTEGER DEFAULT 1,
        last_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    // Reports de capítulo com problema (imagens quebradas etc.), agregados por capítulo.
    await sql`
      CREATE TABLE IF NOT EXISTS chapter_reports (
        id SERIAL PRIMARY KEY,
        manga_id VARCHAR(100) NOT NULL,
        chapter VARCHAR(60) NOT NULL,
        reason VARCHAR(30) DEFAULT 'broken',
        count INTEGER DEFAULT 1,
        status VARCHAR(10) DEFAULT 'open',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(manga_id, chapter)
      );
    `;
    // Views por dia (o total histórico continua em manga_views) → "em alta da semana".
    await sql`
      CREATE TABLE IF NOT EXISTS manga_views_daily (
        manga_id VARCHAR(100) NOT NULL,
        date DATE NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (manga_id, date)
      );
    await sql`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key VARCHAR(100) PRIMARY KEY,
        points INTEGER DEFAULT 0,
        expire_at TIMESTAMP NOT NULL
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_expire ON rate_limits(expire_at);`;
  } catch (err) {
    console.error('Erro na inicialização do banco de dados:', err);
    throw err;
  }
}

async function ensureConnection() {
  if (!isInitialized) {
    await initDB();
    isInitialized = true;
  }
  return sql;
}

module.exports = { sql, ensureConnection };
