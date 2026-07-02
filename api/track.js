// api/track.js — telemetria pública (sem login):
//   POST /api/track?action=usage       body: { anonId, seconds, reading, pages, device }
//   POST /api/track?action=search-miss body: { q }
//   POST /api/track?action=report      body: { mangaId, chapter, reason }
// Os beacons chegam via navigator.sendBeacon (cookies same-origin inclusos),
// então se houver sessão válida o uso é ligado ao usuário logado.
const { ensureConnection } = require('../lib/db');
const jwt = require('jsonwebtoken');
const { checkRateLimit, getClientIp } = require('../lib/rate-limit');

const JWT_SECRET = process.env.JWT_SECRET;

function getCookieValue(str, name) {
  if (!str) return null;
  const m = str.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}

function userIdFrom(req) {
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET).id || null; } catch { return null; }
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  return body || {};
}

// Clampa números vindos do cliente (telemetria é não-confiável por natureza).
function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

async function usage(req, res) {
  const body = parseBody(req);
  const anonId = String(body.anonId || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64);
  if (!anonId) return res.status(400).json({ ok: false });
  // Máximo por beacon: 2h (flush acontece bem antes disso em uso normal).
  const seconds = clampInt(body.seconds, 0, 7200);
  const reading = Math.min(clampInt(body.reading, 0, 7200), seconds);
  const pages = clampInt(body.pages, 0, 1000);
  if (seconds === 0 && pages === 0) return res.status(200).json({ ok: true });
  const device = body.device === 'mobile' ? 'mobile' : 'desktop';
  const userId = userIdFrom(req);
  const sql = await ensureConnection();
  await sql`
    INSERT INTO usage_daily (anon_id, date, user_id, seconds_total, seconds_reading, pages_read, device)
    VALUES (${anonId}, CURRENT_DATE, ${userId}, ${seconds}, ${reading}, ${pages}, ${device})
    ON CONFLICT (anon_id, date) DO UPDATE SET
      seconds_total = usage_daily.seconds_total + EXCLUDED.seconds_total,
      seconds_reading = usage_daily.seconds_reading + EXCLUDED.seconds_reading,
      pages_read = usage_daily.pages_read + EXCLUDED.pages_read,
      user_id = COALESCE(EXCLUDED.user_id, usage_daily.user_id),
      device = EXCLUDED.device,
      updated_at = CURRENT_TIMESTAMP
  `;
  return res.status(200).json({ ok: true });
}

async function searchMiss(req, res) {
  const body = parseBody(req);
  const q = String(body.q || '').toLowerCase().trim().slice(0, 120);
  if (q.length < 3) return res.status(200).json({ ok: true });
  const sql = await ensureConnection();
  await sql`
    INSERT INTO search_misses (query, count) VALUES (${q}, 1)
    ON CONFLICT (query) DO UPDATE SET count = search_misses.count + 1, last_at = CURRENT_TIMESTAMP
  `;
  return res.status(200).json({ ok: true });
}

async function report(req, res) {
  const body = parseBody(req);
  const mangaId = String(body.mangaId || '').slice(0, 100);
  const chapter = String(body.chapter || '').slice(0, 60);
  if (!mangaId || !chapter) return res.status(400).json({ ok: false });
  const REASONS = ['broken', 'wrong', 'other'];
  const reason = REASONS.includes(body.reason) ? body.reason : 'broken';
  const sql = await ensureConnection();
  // Report novo reabre o capítulo mesmo se já foi marcado como resolvido.
  await sql`
    INSERT INTO chapter_reports (manga_id, chapter, reason) VALUES (${mangaId}, ${chapter}, ${reason})
    ON CONFLICT (manga_id, chapter) DO UPDATE SET
      count = chapter_reports.count + 1,
      reason = EXCLUDED.reason,
      status = 'open',
      updated_at = CURRENT_TIMESTAMP
  `;
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (!JWT_SECRET) {
    return res.status(500).json({ ok: false, error: 'Segredo JWT não configurado no servidor' });
  }

  const ip = getClientIp(req);
  // Rate limit para telemetria por IP (60 requisições por minuto)
  const trackLimit = await checkRateLimit(`track_ip:${ip}`, 60, 60);
  if (trackLimit.limited) {
    res.setHeader('Retry-After', trackLimit.retryAfter);
    return res.status(429).json({ ok: false, error: 'Muitas requisições de telemetria.' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }
  const action = (req.query && req.query.action) || '';
  try {
    if (action === 'usage') return await usage(req, res);
    if (action === 'search-miss') return await searchMiss(req, res);
    if (action === 'report') return await report(req, res);
    return res.status(404).json({ ok: false, error: 'Endpoint não encontrado' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
