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
