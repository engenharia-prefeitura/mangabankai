const jwt = require('jsonwebtoken');
const https = require('https');
const { ensureConnection } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_OWNER = 'engenharia-prefeitura';
const GITHUB_REPO = 'mangabankai';
const WORKFLOW_FILE = 'update.yml';
const BRANCH = 'master';

function getCookieValue(cookieString, name) {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

async function checkAdmin(req) {
  const token = getCookieValue(req.headers.cookie || '', 'mb_session');
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const sql = await ensureConnection();
    const result = await sql`SELECT role FROM users WHERE id = ${decoded.id} LIMIT 1`;
    return result.rows && result.rows[0] && result.rows[0].role === 'admin';
  } catch (e) {
    return false;
  }
}

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mangabankai-admin',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await checkAdmin(req);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

  if (!GITHUB_PAT) return res.status(500).json({ error: 'GITHUB_PAT não configurado' });

  const target = (req.body && req.body.target) || 'all';

  // Dispara o workflow_dispatch
  const r = await githubRequest(
    'POST',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    { ref: BRANCH, inputs: { target } }
  );

  if (r.status !== 204) {
    return res.status(500).json({ error: 'Falha ao disparar workflow', detail: r.body });
  }

  // Aguarda 2s e busca o run recém-criado
  await new Promise(ok => setTimeout(ok, 2000));
  const runs = await githubRequest('GET',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1&branch=${BRANCH}`
  );

  const run = runs.body && runs.body.workflow_runs && runs.body.workflow_runs[0];
  res.status(200).json({
    ok: true,
    runId: run ? run.id : null,
    runUrl: run ? run.html_url : `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions`,
    status: run ? run.status : 'queued'
  });
};
