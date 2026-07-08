// api/takedown.js — canal de desindexação para titulares de direitos (Termos §2).
//   POST /api/takedown?action=submit  body: { mangaId, fullName, contactEmail, relationship, proofUrl, details }
//   GET  /api/takedown?action=mine    → solicitações do usuário logado
// O comprovante é obrigatoriamente um PDF hospedado no Google Drive; o backend
// valida o domínio e a assinatura binária %PDF antes de aceitar.

const { ensureConnection } = require('../lib/db');
const jwt = require('jsonwebtoken');
const { checkRateLimit, getClientIp } = require('../lib/rate-limit');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET;

const RELATIONSHIPS = ['autor', 'editora', 'representante', 'distribuidor'];

function getCookieValue(str, name) {
  if (!str) return null;
  const m = str.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}

function getUser(req) {
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return null;
  try {
    const d = jwt.verify(token, JWT_SECRET);
    return { id: d.id, username: d.username };
  } catch { return null; }
}

let _idx = null, _idxTime = 0;
function mangaExists(id) {
  const now = Date.now();
  if (!_idx || now - _idxTime > 60000) {
    try {
      _idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'js', 'manga-search.json'), 'utf8'));
      _idxTime = now;
    } catch { _idx = []; }
  }
  return _idx.some(m => m.id === id);
}

// Extrai o ID de um link do Google Drive. Aceita apenas drive.google.com —
// nada de encurtadores ou domínios que imitem o Drive.
function driveFileId(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com') return null;
  const m = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,})(\/|$)/);
  if (m) return m[1];
  if (u.pathname === '/open' && /^[A-Za-z0-9_-]{10,}$/.test(u.searchParams.get('id') || '')) {
    return u.searchParams.get('id');
  }
  return null;
}

// Baixa só o começo do arquivo no endpoint público do Drive e confere a
// assinatura %PDF. Arquivo privado ou grande demais devolve HTML → rejeita.
async function validateDrivePdf(fileId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, {
      headers: { Range: 'bytes=0-1023' },
      redirect: 'follow',
      signal: ctrl.signal
    });
    const host = new URL(r.url).hostname;
    if (!/(^|\.)google(usercontent)?\.com$/.test(host)) {
      return { ok: false, reason: 'O download não permaneceu em domínio do Google.' };
    }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html')) {
      return { ok: false, reason: 'O arquivo não está público. No Drive, use "Compartilhar → Qualquer pessoa com o link" e verifique se o PDF tem no máximo 20 MB.' };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString('latin1').startsWith('%PDF')) return { ok: true };
    return { ok: false, reason: 'O arquivo não é um PDF válido. Envie o comprovante em formato PDF.' };
  } catch {
    return { ok: false, reason: 'Não foi possível verificar o arquivo no Google Drive. Confira o link e tente novamente.' };
  } finally {
    clearTimeout(timer);
  }
}

async function submit(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Faça login para enviar uma solicitação.' });

  const ipLimit = await checkRateLimit(`takedown_ip:${getClientIp(req)}`, 5, 3600);
  if (ipLimit.limited) {
    res.setHeader('Retry-After', ipLimit.retryAfter);
    return res.status(429).json({ error: 'Muitas solicitações. Tente novamente mais tarde.' });
  }

  const { mangaId, fullName, contactEmail, relationship, proofUrl, details } = req.body || {};
  const name = String(fullName || '').trim();
  const email = String(contactEmail || '').trim().toLowerCase();
  const rel = String(relationship || '').trim();

  if (!mangaId || !mangaExists(String(mangaId))) return res.status(400).json({ error: 'Obra inválida.' });
  if (name.length < 5 || name.length > 150) return res.status(400).json({ error: 'Informe seu nome completo ou razão social.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 150) return res.status(400).json({ error: 'E-mail de contato inválido.' });
  if (!RELATIONSHIPS.includes(rel)) return res.status(400).json({ error: 'Informe seu vínculo com a obra.' });
  if (details && String(details).length > 2000) return res.status(400).json({ error: 'Descrição muito longa (máx. 2000 caracteres).' });

  const fileId = driveFileId(proofUrl);
  if (!fileId) {
    return res.status(400).json({ error: 'O comprovante deve ser um link de arquivo do Google Drive (drive.google.com/file/d/...).' });
  }

  const sql = await ensureConnection();

  const dup = await sql`SELECT id, status FROM takedown_requests WHERE user_id = ${user.id} AND manga_id = ${mangaId} LIMIT 1`;
  if (dup.rows && dup.rows[0]) {
    return res.status(409).json({ error: 'Você já tem uma solicitação para esta obra (nº ' + dup.rows[0].id + ', status: ' + dup.rows[0].status + ').' });
  }
  const pend = await sql`SELECT COUNT(*)::int AS n FROM takedown_requests WHERE user_id = ${user.id} AND status = 'pending'`;
  if (pend.rows[0].n >= 3) {
    return res.status(429).json({ error: 'Você já possui 3 solicitações em análise. Aguarde a conclusão antes de abrir novas.' });
  }

  const pdf = await validateDrivePdf(fileId);
  if (!pdf.ok) return res.status(400).json({ error: pdf.reason });

  const cleanUrl = `https://drive.google.com/file/d/${fileId}/view`;
  const r = await sql`
    INSERT INTO takedown_requests (user_id, manga_id, full_name, contact_email, relationship, proof_url, details)
    VALUES (${user.id}, ${mangaId}, ${name}, ${email}, ${rel}, ${cleanUrl}, ${String(details || '').trim() || null})
    RETURNING id
  `;
  return res.status(201).json({ success: true, id: r.rows[0].id });
}

async function mine(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Faça login.' });
  const sql = await ensureConnection();
  const r = await sql`
    SELECT id, manga_id, relationship, status, admin_note, created_at, resolved_at
    FROM takedown_requests WHERE user_id = ${user.id} ORDER BY created_at DESC
  `;
  return res.status(200).json({ requests: r.rows || [] });
}

module.exports = async (req, res) => {
  if (!JWT_SECRET) return res.status(500).json({ error: 'Segredo JWT não configurado no servidor' });
  const action = (req.query && req.query.action) || '';
  try {
    if (action === 'submit') return await submit(req, res);
    if (action === 'mine') return await mine(req, res);
    return res.status(404).json({ error: 'Endpoint não encontrado' });
  } catch (err) {
    console.error('Erro em /api/takedown:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
