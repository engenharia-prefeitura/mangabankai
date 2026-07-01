const { ensureConnection } = require('../lib/db');
const jwt = require('jsonwebtoken');
const https = require('https');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';
// .trim() remove \r\n ou espaços acidentais (ex: token colado via PowerShell echo)
const GITHUB_PAT = (process.env.GITHUB_PAT || '').trim();
const GITHUB_OWNER = 'engenharia-prefeitura';
const GITHUB_REPO = 'mangabankai';
const WORKFLOW_FILE = 'update.yml';
const BRANCH = 'master';

function getCookieValue(str, name) {
  if (!str) return null;
  const m = str.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}

async function isAdmin(req) {
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const sql = await ensureConnection();
    const r = await sql`SELECT role FROM users WHERE id = ${decoded.id} LIMIT 1`;
    return !!(r.rows && r.rows[0] && r.rows[0].role === 'admin');
  } catch { return false; }
}

// ── search-manga ───────────────────────────────────────────────────────
let _cache = null, _cacheTime = 0;
function getMangaIndex() {
  const now = Date.now();
  if (_cache && now - _cacheTime < 60000) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'js', 'manga-search.json'), 'utf8'));
    _cacheTime = now;
  } catch { _cache = []; }
  return _cache;
}

async function searchManga(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  if (!await isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const q = ((req.query && req.query.q) || '').toLowerCase().trim();
  const sql = await ensureConnection();
  const hidden = await sql`SELECT manga_id FROM hidden_manga`;
  const hiddenSet = new Set((hidden.rows || []).map(r => r.manga_id));
  const all = getMangaIndex();
  const results = q
    ? all.filter(m => (m.title || '').toLowerCase().includes(q)).slice(0, 50)
    : all.filter(m => hiddenSet.has(m.id)).slice(0, 100);
  return res.status(200).json(results.map(m => ({
    id: m.id, slug: m.slug || m.id, title: m.title,
    cover: m.cover || '', hidden: hiddenSet.has(m.id), source: m.source || ''
  })));
}

// ── toggle-hidden ──────────────────────────────────────────────────────
async function toggleHidden(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!await isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const { id, hidden } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'id obrigatório' });
  const sql = await ensureConnection();
  if (hidden) {
    await sql`INSERT INTO hidden_manga (manga_id) VALUES (${id}) ON CONFLICT (manga_id) DO NOTHING`;
  } else {
    await sql`DELETE FROM hidden_manga WHERE manga_id = ${id}`;
  }
  return res.status(200).json({ ok: true, id, hidden: !!hidden });
}

// ── trigger-scrape ─────────────────────────────────────────────────────
function ghRequest(method, ghPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: ghPath, method,
      headers: {
        'Authorization': `Bearer ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mangabankai-admin',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function triggerScrape(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!await isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (!GITHUB_PAT) return res.status(500).json({ error: 'GITHUB_PAT não configurado' });
  const target = (req.body && req.body.target) || 'all';
  const r = await ghRequest('POST',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    { ref: BRANCH, inputs: { target } }
  );
  if (r.status !== 204) return res.status(500).json({ error: 'Falha ao disparar workflow', detail: r.body });
  await new Promise(ok => setTimeout(ok, 2000));
  const runs = await ghRequest('GET',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1&branch=${BRANCH}`
  );
  const run = runs.body && runs.body.workflow_runs && runs.body.workflow_runs[0];
  return res.status(200).json({
    ok: true,
    runId: run ? run.id : null,
    runUrl: run ? run.html_url : `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions`,
    status: run ? run.status : 'queued'
  });
}

// ── scrape-status ──────────────────────────────────────────────────────
async function scrapeStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  if (!await isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const runId = req.query && req.query.runId;
  if (!runId) return res.status(400).json({ error: 'runId obrigatório' });
  const r = await ghRequest('GET', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}`);
  if (r.status !== 200) return res.status(500).json({ error: 'Run não encontrado' });
  return res.status(200).json({
    status: r.body.status,
    conclusion: r.body.conclusion,
    runUrl: r.body.html_url,
    startedAt: r.body.run_started_at,
    updatedAt: r.body.updated_at
  });
}

// ── settings ───────────────────────────────────────────────────────────
// Teto de obras NOVAS por execução de cada scraper. Persistido no site_settings
// (chave cap_<provider>) e aplicado no scraper-config.json pelo check-scheduler
// no início de cada execução do workflow. Defaults espelham scraper-config.json.
const CAP_KEYS = {
  mangafreak: 40, hentai20: 25, mangadex: 1000,
  madara: 20, mundohentai: 10, leituramanga: 0, mangalivre: 0
};
function capsFrom(data) {
  const caps = {};
  for (const k of Object.keys(CAP_KEYS)) {
    const v = parseInt(data['cap_' + k], 10);
    caps[k] = isNaN(v) ? CAP_KEYS[k] : v;
  }
  return caps;
}
function settingsPayload(data) {
  return {
    ok: true,
    transition_delay: parseInt(data['transition_delay'] || '10', 10),
    caps: capsFrom(data),
    scheduler: {
      enabled: data['scheduler_enabled'] === 'true',
      interval: data['scheduler_interval'] || '12h',
      lang: data['scheduler_lang'] || 'pt',
      mode: data['scheduler_mode'] || 'incremental',
      lastRun: data['scheduler_last_run'] ? parseInt(data['scheduler_last_run'], 10) : null,
      lastStatus: data['scheduler_last_status'] || null
    }
  };
}

async function settings(req, res) {
  if (!await isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const sql = await ensureConnection();
  if (req.method === 'GET') {
    const r = await sql`SELECT key, value FROM site_settings`;
    const data = {};
    (r.rows || []).forEach(row => { data[row.key] = row.value; });
    return res.status(200).json(settingsPayload(data));
  }
  if (req.method === 'POST') {
    const { transition_delay, scheduler, caps } = req.body || {};
    if (transition_delay !== undefined) {
      const delay = parseInt(transition_delay, 10);
      const val = String(isNaN(delay) ? 10 : delay);
      await sql`
        INSERT INTO site_settings (key, value) VALUES ('transition_delay', ${val})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `;
    }
    if (caps !== undefined && caps && typeof caps === 'object') {
      const queries = [];
      for (const k of Object.keys(CAP_KEYS)) {
        if (caps[k] == null) continue;
        const v = parseInt(caps[k], 10);
        if (isNaN(v) || v < 0) continue;
        queries.push(sql`INSERT INTO site_settings (key, value) VALUES (${'cap_' + k}, ${String(v)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      }
      if (queries.length) await Promise.all(queries);
    }
    if (scheduler !== undefined) {
      const { enabled, interval, lang, mode } = scheduler;
      const queries = [
        sql`INSERT INTO site_settings (key, value) VALUES ('scheduler_enabled', ${String(!!enabled)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        sql`INSERT INTO site_settings (key, value) VALUES ('scheduler_interval', ${String(interval || '12h')}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        sql`INSERT INTO site_settings (key, value) VALUES ('scheduler_lang', ${String(lang || 'pt')}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        sql`INSERT INTO site_settings (key, value) VALUES ('scheduler_mode', ${String(mode || 'incremental')}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      ];
      await Promise.all(queries);
    }
    // Read them back
    const r = await sql`SELECT key, value FROM site_settings`;
    const data = {};
    (r.rows || []).forEach(row => { data[row.key] = row.value; });
    return res.status(200).json(settingsPayload(data));
  }
  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Método não permitido' });
}

// ── router ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';
  if (action === 'search-manga') return searchManga(req, res);
  if (action === 'toggle-hidden') return toggleHidden(req, res);
  if (action === 'trigger-scrape') return triggerScrape(req, res);
  if (action === 'scrape-status') return scrapeStatus(req, res);
  if (action === 'settings') return settings(req, res);
  res.status(404).json({ error: 'Endpoint não encontrado' });
};
