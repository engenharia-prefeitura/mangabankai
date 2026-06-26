const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';

function getCookieValue(cookieString, name) {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

module.exports = async (req, res) => {
  // Apenas GET é suportado para ler o perfil
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  }

  const cookieHeader = req.headers.cookie || '';
  const token = getCookieValue(cookieHeader, 'mb_session');

  if (!token) {
    return res.status(200).json({ authenticated: false, user: null });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.status(200).json({
      authenticated: true,
      user: { id: decoded.id, username: decoded.username }
    });
  } catch (err) {
    // Se o token estiver expirado ou corrompido, limpa o cookie inválido
    res.setHeader('Set-Cookie', 'mb_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
    return res.status(200).json({ authenticated: false, user: null, message: 'Sessão expirada' });
  }
};
