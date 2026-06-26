const { ensureConnection } = require('../db');

module.exports = async (req, res) => {
  const mangaId = req.query.mangaId || (req.body && req.body.mangaId);

  if (!mangaId) {
    return res.status(400).json({ error: 'Parâmetro mangaId é obrigatório' });
  }

  try {
    const sql = await ensureConnection();

    if (req.method === 'GET') {
      const result = await sql`
        SELECT count FROM manga_views WHERE manga_id = ${mangaId} LIMIT 1;
      `;
      const count = result.rows && result.rows.length > 0 ? result.rows[0].count : 0;
      return res.status(200).json({ count });
    } 
    
    if (req.method === 'POST') {
      // Upsert atômico de visualizações
      const result = await sql`
        INSERT INTO manga_views (manga_id, count)
        VALUES (${mangaId}, 1)
        ON CONFLICT (manga_id)
        DO UPDATE SET count = manga_views.count + 1, updated_at = CURRENT_TIMESTAMP
        RETURNING count;
      `;
      const updatedCount = result.rows[0].count;
      return res.status(200).json({ success: true, count: updatedCount });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  } catch (err) {
    console.error('Erro no controle de views:', err);
    return res.status(500).json({ error: 'Erro interno do servidor no controle de views' });
  }
};
