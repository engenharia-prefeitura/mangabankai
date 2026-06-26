const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { ensureConnection } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';

function getCookieValue(cookieString, name) {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

async function checkAdmin(req) {
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const sql = await ensureConnection();
    const result = await sql`SELECT role FROM users WHERE id = ${decoded.id} LIMIT 1`;
    return result.rows && result.rows[0] && result.rows[0].role === 'admin';
  } catch (e) {
    return false;
  }
}

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minuto

function getMangaIndex() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;
  try {
    const p = path.join(__dirname, '..', '..', 'js', 'manga-search.json');
    _cache = JSON.parse(fs.readFileSync(p, 'utf8'));
    _cacheTime = now;
  } catch (e) {
    _cache = [];
  }
  return _cache;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await checkAdmin(req);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const q = ((req.query && req.query.q) || '').toLowerCase().trim();

  const sql = await ensureConnection();
  const hiddenResult = await sql`SELECT manga_id FROM hidden_manga`;
  const hiddenSet = new Set((hiddenResult.rows || []).map(r => r.manga_id));

  const all = getMangaIndex();

  let results;
  if (!q) {
    results = all.filter(m => hiddenSet.has(m.id)).slice(0, 100);
  } else {
    results = all.filter(m => (m.title || '').toLowerCase().includes(q)).slice(0, 50);
  }

  const out = results.map(m => ({
    id: m.id,
    slug: m.slug || m.id,
    title: m.title,
    cover: m.cover || '',
    hidden: hiddenSet.has(m.id),
    source: m.source || ''
  }));

  res.status(200).json(out);
};
