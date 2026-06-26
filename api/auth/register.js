const { ensureConnection } = require('../db');
const bcrypt = require('bcryptjs');

module.exports = async (req, res) => {
  // Garantir que é um método POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Método ${req.method} não permitido` });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 3 || cleanUsername.length > 20) {
    return res.status(400).json({ error: 'O usuário deve ter entre 3 e 20 caracteres' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
  }

  try {
    const sql = await ensureConnection();

    // Verificar se o usuário já existe
    const existingUser = await sql`
      SELECT id FROM users WHERE username = ${cleanUsername} LIMIT 1;
    `;

    if (existingUser.rows && existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Este nome de usuário já está sendo utilizado' });
    }

    // Criptografar a senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Inserir no banco
    const result = await sql`
      INSERT INTO users (username, password)
      VALUES (${cleanUsername}, ${hashedPassword})
      RETURNING id, username, created_at;
    `;

    const user = result.rows[0];
    return res.status(201).json({ success: true, message: 'Usuário registrado com sucesso', user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Erro no registro do usuário:', err);
    return res.status(500).json({ error: 'Erro interno do servidor ao registrar usuário' });
  }
};
