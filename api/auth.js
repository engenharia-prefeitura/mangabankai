const { ensureConnection } = require('../lib/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { checkRateLimit, getClientIp } = require('../lib/rate-limit');

const JWT_SECRET = process.env.JWT_SECRET;

function getCookieValue(str, name) {
  if (!str) return null;
  const m = str.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}

function cookieOpts() {
  const s = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `; Path=/; HttpOnly; SameSite=Lax${s}`;
}

async function login(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios' });

  const ip = getClientIp(req);
  const clean = username.trim().toLowerCase();

  // Rate limit por IP (10 por minuto)
  const ipLimit = await checkRateLimit(`login_ip:${ip}`, 10, 60);
  if (ipLimit.limited) {
    res.setHeader('Retry-After', ipLimit.retryAfter);
    return res.status(429).json({ error: `Muitas tentativas de login de seu IP. Tente novamente em ${ipLimit.retryAfter} segundos.` });
  }

  // Rate limit por conta de usuário (5 por minuto)
  const userLimit = await checkRateLimit(`login_user:${clean}`, 5, 60);
  if (userLimit.limited) {
    res.setHeader('Retry-After', userLimit.retryAfter);
    return res.status(429).json({ error: `Muitas tentativas para esta conta. Tente novamente em ${userLimit.retryAfter} segundos.` });
  }

  const sql = await ensureConnection();
  const r = await sql`SELECT id, username, password, role FROM users WHERE username = ${clean} LIMIT 1`;
  if (!r.rows || !r.rows[0]) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  const user = r.rows[0];
  if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.setHeader('Set-Cookie', `mb_session=${token}; Max-Age=2592000${cookieOpts()}`);
  return res.status(200).json({ success: true, user: { id: user.id, username: user.username, role: user.role || 'user' } });
}

async function logout(req, res) {
  res.setHeader('Set-Cookie', `mb_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT${cookieOpts()}`);
  return res.status(200).json({ success: true });
}

async function me(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return res.status(200).json({ authenticated: false, user: null });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.status(200).json({ authenticated: true, user: { id: decoded.id, username: decoded.username, role: decoded.role || 'user' } });
  } catch {
    res.setHeader('Set-Cookie', `mb_session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT${cookieOpts()}`);
    return res.status(200).json({ authenticated: false, user: null });
  }
}

async function register(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios' });

  const ip = getClientIp(req);
  // Rate limit por IP de cadastro (5 por hora)
  const regLimit = await checkRateLimit(`register_ip:${ip}`, 5, 3600);
  if (regLimit.limited) {
    res.setHeader('Retry-After', regLimit.retryAfter);
    return res.status(429).json({ error: `Limite de cadastros excedido para seu IP. Tente novamente em ${Math.ceil(regLimit.retryAfter / 60)} minutos.` });
  }

  const clean = username.trim().toLowerCase();
  if (clean.length < 3 || clean.length > 20) return res.status(400).json({ error: 'Usuário deve ter entre 3 e 20 caracteres' });
  
  const usernameRegex = /^[a-z0-9_.-]+$/;
  if (!usernameRegex.test(clean)) {
    return res.status(400).json({ error: 'Nome de usuário inválido. Use apenas letras minúsculas, números, sublinhados, pontos ou hífens.' });
  }

  if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
  if (password.length > 72) return res.status(400).json({ error: 'Senha deve ter no máximo 72 caracteres' });

  const sql = await ensureConnection();
  const ex = await sql`SELECT id FROM users WHERE username = ${clean} LIMIT 1`;
  if (ex.rows && ex.rows.length > 0) return res.status(409).json({ error: 'Usuário já existe' });
  const hash = await bcrypt.hash(password, await bcrypt.genSalt(10));
  const r = await sql`INSERT INTO users (username, password) VALUES (${clean}, ${hash}) RETURNING id, username, role`;
  return res.status(201).json({ success: true, user: { id: r.rows[0].id, username: r.rows[0].username, role: r.rows[0].role || 'user' } });
}

async function checkAdmin(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return res.status(200).json({ isAdmin: false });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const sql = await ensureConnection();
    const r = await sql`SELECT role FROM users WHERE id = ${decoded.id} LIMIT 1`;
    return res.status(200).json({ isAdmin: !!(r.rows && r.rows[0] && r.rows[0].role === 'admin') });
  } catch {
    return res.status(200).json({ isAdmin: false });
  }
}

module.exports = async (req, res) => {
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Segredo JWT não configurado no servidor' });
  }
  const action = (req.query && req.query.action) || '';
  if (action === 'login') return login(req, res);
  if (action === 'logout') return logout(req, res);
  if (action === 'me') return me(req, res);
  if (action === 'register') return register(req, res);
  if (action === 'check-admin') return checkAdmin(req, res);
  res.status(404).json({ error: 'Endpoint não encontrado' });
};
