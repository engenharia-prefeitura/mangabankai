const { ensureConnection } = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';

module.exports = async (req, res) => {
  // Garantir método POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    const sql = await ensureConnection();

    // Buscar usuário pelo nome
    const result = await sql`
      SELECT id, username, password FROM users WHERE username = ${cleanUsername} LIMIT 1;
    `;

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }

    const user = result.rows[0];

    // Comparar senhas
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }

    // Criar Token JWT
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Configurar o Cookie HTTP-Only
    const isProd = process.env.NODE_ENV === 'production';
    const cookieSerialized = `mb_session=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`;
    
    res.setHeader('Set-Cookie', cookieSerialized);

    return res.status(200).json({
      success: true,
      message: 'Login realizado com sucesso',
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error('Erro ao fazer login:', err);
    return res.status(500).json({ error: 'Erro interno do servidor ao realizar login' });
  }
};
