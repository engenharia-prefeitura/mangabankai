const { ensureConnection } = require('../db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';

function getCookieValue(cookieString, name) {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

module.exports = async (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const token = getCookieValue(cookieHeader, 'mb_session');

  if (!token) {
    return res.status(401).json({ error: 'Usuário não autenticado' });
  }

  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.id;
  } catch (err) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada' });
  }

  try {
    const sql = await ensureConnection();

    // GET: Listar favoritos do usuário
    if (req.method === 'GET') {
      const result = await sql`
        SELECT manga_id FROM favorites WHERE user_id = ${userId} ORDER BY created_at DESC;
      `;
      const favoritesList = result.rows.map(row => row.manga_id);
      return res.status(200).json({ favorites: favoritesList });
    }

    // POST: Alternar (toggle) favorito
    if (req.method === 'POST') {
      const mangaId = req.query.mangaId || (req.body && req.body.mangaId);
      if (!mangaId) {
        return res.status(400).json({ error: 'Parâmetro mangaId é obrigatório' });
      }

      // Verificar se já é favorito
      const existing = await sql`
        SELECT id FROM favorites WHERE user_id = ${userId} AND manga_id = ${mangaId} LIMIT 1;
      `;

      let favorited = false;
      if (existing.rows && existing.rows.length > 0) {
        // Remover favorito
        await sql`
          DELETE FROM favorites WHERE user_id = ${userId} AND manga_id = ${mangaId};
        `;
      } else {
        // Adicionar favorito
        await sql`
          INSERT INTO favorites (user_id, manga_id)
          VALUES (${userId}, ${mangaId});
        `;
        favorited = true;
      }

      return res.status(200).json({ success: true, favorited });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  } catch (err) {
    console.error('Erro ao processar favoritos:', err);
    return res.status(500).json({ error: 'Erro interno do servidor no processamento de favoritos' });
  }
};
