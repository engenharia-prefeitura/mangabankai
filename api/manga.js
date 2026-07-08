const { ensureConnection } = require('../lib/db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

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

async function pdfDownload(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const { mangaId, mangaTitle, chapterId, chapterNumber } = req.body || {};
  if (!mangaId || !chapterId) return res.status(400).json({ error: 'mangaId e chapterId obrigatórios' });
  const sql = await ensureConnection();
  await sql`
    INSERT INTO pdf_downloads (manga_id, manga_title, chapter_id, chapter_number)
    VALUES (${String(mangaId)}, ${String(mangaTitle || '')}, ${String(chapterId)}, ${chapterNumber ? String(chapterNumber) : null})
  `.catch(() => {});
  return res.status(200).json({ success: true });
}

async function settings(req, res) {
  const sql = await ensureConnection();
  if (req.method === 'GET') {
    try {
      const r = await sql`SELECT key, value FROM site_settings`;
      const data = {};
      (r.rows || []).forEach(row => { data[row.key] = row.value; });
      return res.status(200).json({
        transition_delay: data['transition_delay'] ? parseInt(data['transition_delay'], 10) : 10,
        news: {
          enabled: data['news_enabled'] === 'true',
          content: data['news_content'] || '',
          duration_days: data['news_duration_days'] ? parseInt(data['news_duration_days'], 10) : 10,
          updated_at: data['news_updated_at'] ? parseInt(data['news_updated_at'], 10) : 0
        }
      });
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
      SELECT manga_id, chapter_id, chapter_number, page_index, total_pages, updated_at 
      FROM reading_progress 
      WHERE user_id = ${userId} 
      ORDER BY updated_at DESC
    `;
    const progress = {};
    (r.rows || []).forEach(row => {
      progress[row.manga_id] = {
        chapterId: row.chapter_id,
        chapterNumber: row.chapter_number,
        pageIndex: row.page_index,
        totalPages: row.total_pages,
        updatedAt: new Date(row.updated_at).getTime()
      };
    });
    return res.status(200).json({ history: progress });
  }

  if (req.method === 'POST') {
    const { mangaId, chapterId, chapterNumber, pageIndex, totalPages } = req.body || {};
    if (!mangaId || !chapterId) return res.status(400).json({ error: 'Parâmetros insuficientes' });
    
    const chNumStr = chapterNumber != null ? String(chapterNumber) : null;
    await sql`
      INSERT INTO reading_progress (user_id, manga_id, chapter_id, chapter_number, page_index, total_pages, updated_at) 
      VALUES (${userId}, ${mangaId}, ${chapterId}, ${chNumStr}, ${pageIndex}, ${totalPages}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, manga_id) DO UPDATE SET 
        chapter_id = EXCLUDED.chapter_id, 
        chapter_number = EXCLUDED.chapter_number,
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
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Segredo JWT não configurado no servidor' });
  }
  const action = (req.query && req.query.action) || '';
  if (action === 'favorites') return favorites(req, res);
  if (action === 'views') return views(req, res);
  if (action === 'settings') return settings(req, res);
  if (action === 'history') return history(req, res);
  if (action === 'pdf-download') return pdfDownload(req, res);
  res.status(404).json({ error: 'Endpoint não encontrado' });
};
