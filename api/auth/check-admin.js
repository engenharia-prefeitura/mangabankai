const { ensureConnection } = require('../db');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';

function getCookieValue(cookieString, name) {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

module.exports = async (req, res) => {
  // Apenas método GET é permitido
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  }

  const cookieHeader = req.headers.cookie || '';
  const token = getCookieValue(cookieHeader, 'mb_session');

  if (!token) {
    return res.status(200).json({ isAdmin: false, reason: 'Nenhuma sessão ativa encontrada' });
  }

  try {
    // 1) Verificar e decodificar o token JWT
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;

    // 2) Consultar o banco para obter o papel real (role) do usuário
    const sql = await ensureConnection();
    const result = await sql`
      SELECT role FROM users WHERE id = ${userId} LIMIT 1;
    `;

    if (!result.rows || result.rows.length === 0) {
      return res.status(200).json({ isAdmin: false, reason: 'Usuário não encontrado no banco' });
    }

    const userRole = result.rows[0].role;

    // 3) Conferir se é administrador
    if (userRole === 'admin') {
      return res.status(200).json({ isAdmin: true });
    }

    return res.status(200).json({ isAdmin: false, reason: 'Acesso negado: o usuário não é administrador' });
  } catch (err) {
    console.error('Erro na verificação de admin:', err);
    return res.status(200).json({ isAdmin: false, reason: 'Erro interno ao validar autenticação' });
  }
};
