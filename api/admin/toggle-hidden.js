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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await checkAdmin(req);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const { id, hidden } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  try {
    const sql = await ensureConnection();
    if (hidden) {
      await sql`
        INSERT INTO hidden_manga (manga_id)
        VALUES (${id})
        ON CONFLICT (manga_id) DO NOTHING
      `;
    } else {
      await sql`DELETE FROM hidden_manga WHERE manga_id = ${id}`;
    }
    res.status(200).json({ ok: true, id, hidden: !!hidden });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
