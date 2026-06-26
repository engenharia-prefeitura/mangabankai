const jwt = require('jsonwebtoken');
const https = require('https');
const { ensureConnection } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'mangabankai-secret-default-key-12345';
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_OWNER = 'engenharia-prefeitura';
const GITHUB_REPO = 'mangabankai';

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

function githubRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mangabankai-admin'
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin = await checkAdmin(req);
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const runId = req.query && req.query.runId;
  if (!runId) return res.status(400).json({ error: 'runId obrigatório' });

  const r = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}`);
  if (r.status !== 200) return res.status(500).json({ error: 'Run não encontrado' });

  const run = r.body;
  res.status(200).json({
    status: run.status,         // queued | in_progress | completed
    conclusion: run.conclusion, // success | failure | null
    runUrl: run.html_url,
    startedAt: run.run_started_at,
    updatedAt: run.updated_at
  });
};
