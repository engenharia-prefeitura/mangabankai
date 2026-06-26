module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  }

  // Limpa o cookie mb_session
  const isProd = process.env.NODE_ENV === 'production';
  const cookieSerialized = `mb_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`;
  
  res.setHeader('Set-Cookie', cookieSerialized);

  return res.status(200).json({ success: true, message: 'Logout realizado com sucesso' });
};
