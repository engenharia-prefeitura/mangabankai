const { ensureConnection } = require('../lib/db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';

function getCookieValue(str, name) {
  if (!str) return null;
  const m = str.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}

async function favorites(req, res) {
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  let userId;
  try { userId = jwt.verify(token, JWT_SECRET).id; }
  catch { return res.status(401).json({ error: 'Sessão inválida' }); }
  const sql = await ensureConnection();
  if (req.method === 'GET') {
    const r = await sql`SELECT manga_id FROM favorites WHERE user_id = ${userId} ORDER BY created_at DESC`;
    return res.status(200).json({ favorites: r.rows.map(r => r.manga_id) });
  }
  if (req.method === 'POST') {
    const mangaId = (req.query && req.query.mangaId) || (req.body && req.body.mangaId);
    if (!mangaId) return res.status(400).json({ error: 'mangaId obrigatório' });
    const ex = await sql`SELECT id FROM favorites WHERE user_id = ${userId} AND manga_id = ${mangaId} LIMIT 1`;
    if (ex.rows && ex.rows.length > 0) {
      await sql`DELETE FROM favorites WHERE user_id = ${userId} AND manga_id = ${mangaId}`;
      return res.status(200).json({ success: true, favorited: false });
    }
    await sql`INSERT INTO favorites (user_id, manga_id) VALUES (${userId}, ${mangaId})`;
    return res.status(200).json({ success: true, favorited: true });
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Método não permitido' });
}

async function views(req, res) {
  const mangaId = (req.query && req.query.mangaId) || (req.body && req.body.mangaId);
  if (!mangaId) return res.status(400).json({ error: 'mangaId obrigatório' });
  const sql = await ensureConnection();
  if (req.method === 'GET') {
    const r = await sql`SELECT count FROM manga_views WHERE manga_id = ${mangaId} LIMIT 1`;
    return res.status(200).json({ count: r.rows && r.rows[0] ? r.rows[0].count : 0 });
  }
  if (req.method === 'POST') {
    const r = await sql`
      INSERT INTO manga_views (manga_id, count) VALUES (${mangaId}, 1)
      ON CONFLICT (manga_id) DO UPDATE SET count = manga_views.count + 1, updated_at = CURRENT_TIMESTAMP
      RETURNING count
    `;
    // Registro diário → alimenta o "em alta da semana" no painel de estatísticas.
    await sql`
      INSERT INTO manga_views_daily (manga_id, date, count) VALUES (${mangaId}, CURRENT_DATE, 1)
      ON CONFLICT (manga_id, date) DO UPDATE SET count = manga_views_daily.count + 1
    `.catch(() => {});
    return res.status(200).json({ success: true, count: r.rows[0].count });
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Método não permitido' });
}

async function settings(req, res) {
  const sql = await ensureConnection();
  if (req.method === 'GET') {
    try {
      const r = await sql`SELECT value FROM site_settings WHERE key = 'transition_delay' LIMIT 1`;
      const delay = r.rows && r.rows[0] ? parseInt(r.rows[0].value, 10) : 10;
      return res.status(200).json({ transition_delay: delay });
    } catch (e) {
      return res.status(200).json({ transition_delay: 10 });
    }
  }
  res.setHeader('Allow', ['GET']);
  return res.status(405).json({ error: 'Método não permitido' });
}

async function history(req, res) {
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  let userId;
  try { userId = jwt.verify(token, JWT_SECRET).id; }
  catch { return res.status(401).json({ error: 'Sessão inválida' }); }
  const sql = await ensureConnection();

  if (req.method === 'GET') {
    const r = await sql`
      SELECT manga_id, chapter_id, page_index, total_pages, updated_at 
      FROM reading_progress 
      WHERE user_id = ${userId} 
      ORDER BY updated_at DESC
    `;
    const progress = {};
    (r.rows || []).forEach(row => {
      progress[row.manga_id] = {
        chapterId: row.chapter_id,
        pageIndex: row.page_index,
        totalPages: row.total_pages,
        updatedAt: new Date(row.updated_at).getTime()
      };
    });
    return res.status(200).json({ history: progress });
  }

  if (req.method === 'POST') {
    const { mangaId, chapterId, pageIndex, totalPages } = req.body || {};
    if (!mangaId || !chapterId) return res.status(400).json({ error: 'Parâmetros insuficientes' });
    
    await sql`
      INSERT INTO reading_progress (user_id, manga_id, chapter_id, page_index, total_pages, updated_at) 
      VALUES (${userId}, ${mangaId}, ${chapterId}, ${pageIndex}, ${totalPages}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, manga_id) DO UPDATE SET 
        chapter_id = EXCLUDED.chapter_id, 
        page_index = EXCLUDED.page_index, 
        total_pages = EXCLUDED.total_pages, 
        updated_at = CURRENT_TIMESTAMP
    `;
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const mangaId = req.query && req.query.mangaId;
    if (mangaId) {
      await sql`DELETE FROM reading_progress WHERE user_id = ${userId} AND manga_id = ${mangaId}`;
    } else {
      await sql`DELETE FROM reading_progress WHERE user_id = ${userId}`;
    }
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  return res.status(405).json({ error: 'Método não permitido' });
}

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';
  if (action === 'favorites') return favorites(req, res);
  if (action === 'views') return views(req, res);
  if (action === 'settings') return settings(req, res);
  if (action === 'history') return history(req, res);
  res.status(404).json({ error: 'Endpoint não encontrado' });
};
