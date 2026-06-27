// admin-server.cjs
// PT: usa metodologia do leituramanga-scraper.cjs (RSC payload, CDN links)
// EN: usa metodologia do mf-chapter-scraper.cjs + mf-meta-scraper.cjs
//     (ww2.mangafreak.me HTML, pages:[] vazias — imagens descobertas on-demand pelo leitor)

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const DATA_JS_PATH  = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR  = path.join(__dirname, 'js', 'chapters');
const MF_LIST_FILE  = path.join(__dirname, 'js', 'mf-manga-list.json');

// ── EN (MangaFreak) ─────────────────────────────────────────────────────────────
const BASE_EN   = 'https://ww2.mangafreak.me';   // mesmo do mf-chapter-scraper.cjs

// ── PT (LeituraManga) ──────────────────────────────────────────────────────────
const BASE_PT   = 'https://leituramanga.net';
const CDN_PT    = 'https://cdn.leituramanga.net/';

// ── PT (MangaLivre) ────────────────────────────────────────────────────────────
const BASE_ML   = 'https://mangalivre.blog';
const API_ML    = 'https://mangalivre.blog/wp-json/wp/v2';

// ── EN (Hentai20) ──────────────────────────────────────────────────────────────
const BASE_H20  = 'https://hentai20.io';

// ── PT (MundoHentai) ───────────────────────────────────────────────────────────
const BASE_MH   = 'https://mundohentaioficial.com';

// ── Velocidades ────────────────────────────────────────────────────────────────
const DELAY_SAFE = 1200;   // ms por requisição — seguro
const DELAY_FAST = 200;    // ms por requisição — rápido (igual ao mf-chapter-scraper original)
const WORKERS_PT = 4;      // workers PT paralelos (API tem rate limit → 4 é estável)
const WORKERS_EN = 5;      // workers EN paralelos (igual ao CONCURRENCY original)

// Delays específicos do PT (via API JSON). O freio adaptativo (ptApiFetch) cuida
// do rate limit; estes são só o espaçamento base entre requisições.
const DELAY_PT_FAST = 0;     // sem espera — só há 2 chamadas de API no total agora
const DELAY_PT_SAFE = 200;   // bem de leve (caso queira pegar mais devagar)

// ── Estado ─────────────────────────────────────────────────────────────────────
const PROGRESS_FILE = path.join(__dirname, 'admin-progress.json');
let state = loadState();
let clients = [];
let controllers = {};

function loadState() {
  let s;
  if (fs.existsSync(PROGRESS_FILE)) {
    try { s = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch(e) {}
  }
  if (!s) {
    s = {
      pt: { status:'idle', processed:0, total:0, current:[], errors:0, startedAt:null, queue:[], speed:'fast', mode:'incremental' },
      en: { status:'idle', processed:0, total:0, current:[], errors:0, startedAt:null, queue:[], speed:'fast', mode:'incremental' },
      log: []
    };
  }
  
  // ensure subSteps exists
  if (!s.pt.subSteps) {
    s.pt.subSteps = [
      { id: 'leituramanga', name: 'LeituraManga', status: 'idle', processed: 0, total: 0 },
      { id: 'mangalivre', name: 'MangaLivre', status: 'idle', processed: 0, total: 0 },
      { id: 'mundohentai', name: 'MundoHentai (+18)', status: 'idle', processed: 0, total: 0 }
    ];
  }
  // Add mundohentai subStep to existing saved state if missing
  if (s.pt.subSteps && !s.pt.subSteps.find(step => step.id === 'mundohentai')) {
    s.pt.subSteps.push({ id: 'mundohentai', name: 'MundoHentai (+18)', status: 'idle', processed: 0, total: 0 });
  }
  if (!s.en.subSteps) {
    s.en.subSteps = [
      { id: 'mangafreak', name: 'MangaFreak', status: 'idle', processed: 0, total: 0 },
      { id: 'hentai20', name: 'Hentai20.io (+18 EN)', status: 'idle', processed: 0, total: 0 }
    ];
  }
  if (s.en.subSteps && !s.en.subSteps.find(step => step.id === 'hentai20')) {
    s.en.subSteps.push({ id: 'hentai20', name: 'Hentai20.io (+18 EN)', status: 'idle', processed: 0, total: 0 });
  }

  // Clean up running status on startup since the process is not running yet
  if (s.pt.status === 'running') {
    s.pt.status = 'paused';
    s.pt.subSteps.forEach(step => {
      if (step.status === 'running') step.status = 'paused';
    });
  }
  if (s.en.status === 'running') {
    s.en.status = 'paused';
    s.en.subSteps.forEach(step => {
      if (step.status === 'running') step.status = 'paused';
    });
  }
  if (!s.scheduler) {
    s.scheduler = {
      enabled: false,
      interval: '12h',
      lang: 'pt',
      mode: 'incremental',
      lastRun: null,
      nextRun: null
    };
  }

  if (typeof s.transition_delay === 'undefined') {
    s.transition_delay = 10;
  }

  return s;
}

function saveState() {
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch(e) {}
}

function updateSubStep(lang, id, fields) {
  if (!state[lang].subSteps) {
    if (lang === 'pt') {
      state[lang].subSteps = [
        { id: 'leituramanga', name: 'LeituraManga', status: 'idle', processed: 0, total: 0 },
        { id: 'mangalivre', name: 'MangaLivre', status: 'idle', processed: 0, total: 0 },
        { id: 'mundohentai', name: 'MundoHentai (+18)', status: 'idle', processed: 0, total: 0 }
      ];
    } else {
      state[lang].subSteps = [
        { id: 'mangafreak', name: 'MangaFreak', status: 'idle', processed: 0, total: 0 }
      ];
    }
  }
  const step = state[lang].subSteps.find(s => s.id === id);
  if (step) {
    Object.assign(step, fields);
  }
  saveState();
}

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients = clients.filter(r => { try { r.write(msg); return true; } catch(e) { return false; } });
}

function log(lang, msg, type = 'info') {
  const entry = { time: new Date().toISOString(), lang, msg, type };
  state.log.unshift(entry);
  if (state.log.length > 300) state.log = state.log.slice(0, 300);
  broadcast({ type: 'log', entry, state: { pt: omitQueue(state.pt), en: omitQueue(state.en), scheduler: state.scheduler } });
}

function omitQueue(s) {
  const { queue, ...rest } = s;
  return { ...rest, queueLen: queue.length };
}

function broadcastState() {
  broadcast({ type: 'state', state: { pt: omitQueue(state.pt), en: omitQueue(state.en), scheduler: state.scheduler } });
}

// ── HTTP fetch genérico ────────────────────────────────────────────────────────
function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 25000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrl(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 429 || res.statusCode === 503)
        return reject(new Error(`RATE_LIMIT:${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchUrlWithHeaders(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 25000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrlWithHeaders(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 429 || res.statusCode === 503)
        return reject(new Error(`RATE_LIMIT:${res.statusCode}`));
      const responseHeaders = res.headers;
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ body: data, headers: responseHeaders }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchBinary(url, extraHeaders = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...extraHeaders },
      timeout: 15000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchBinary(next, extraHeaders, redirects + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg', status: res.statusCode }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}


// ── data.js helpers (cache em memória) ────────────────────────────────────────
let _cache = null;
let _dirty = false;
let _saveTimer = null;

// Brace-matching que respeita strings JSON — evita parar prematuramente em ] dentro de "strings"
function findArrayEnd(content, si) {
  let depth = 0, inStr = false, esc = false;
  for (let i = si; i < content.length; i++) {
    const c = content[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) return i + 1; }
    }
  }
  return -1; // não fechou
}

function getMangaData() {
  if (_cache) return _cache;
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const marker = 'let MANGA_DATA = ';
  const si = content.indexOf(marker) + marker.length;
  const ei = findArrayEnd(content, si);
  if (ei < 0) throw new Error('data.js corrompido: array MANGA_DATA não fechado');
  _cache = { before: content.substring(0, si), after: content.substring(ei), data: JSON.parse(content.substring(si, ei)) };
  return _cache;
}

function scheduleSave() {
  _dirty = true;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSave, 2000);
}

function flushSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  if (_cache && _dirty) {
    // NÃO re-lê data.js — usa _cache.before e _cache.after fixados na leitura inicial.
    // Isso evita que um data.js corrompido sobrescreva o footer correto.
    fs.writeFileSync(DATA_JS_PATH, _cache.before + JSON.stringify(_cache.data, null, 2) + _cache.after, 'utf8');
    _dirty = false;
    try { require('./build-lite.cjs').buildLite(); } catch (e) {}
    try { require('./build-home.cjs').buildHome(); } catch (e) {}
  }
}

function normalize(t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function findManga(title, slug) {
  const { data } = getMangaData();
  const nt = normalize(title);
  const ns = slug.toLowerCase().replace(/_/g, '-');
  return data.find(m =>
    m.id === ns || m.slug === slug || normalize(m.slug) === ns ||
    normalize(m.title) === nt || (m.altTitle && normalize(m.altTitle) === nt)
  );
}

function loadChaptersFile(id) {
  const p = path.join(CHAPTERS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return {}; }
}

function saveChaptersFile(id, obj) {
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(CHAPTERS_DIR, `${id}.json`), JSON.stringify(obj, null, 2), 'utf8');
}

// ══════════════════════════════════════════════════════════════════════════════
//  PT SCRAPER — igual ao leituramanga-scraper.cjs
// ══════════════════════════════════════════════════════════════════════════════

// ── Catálogo PT via API (rápido) ──────────────────────────────────────────────
const API_PT = 'https://api.leituramanga.net';
const PT_LIMIT = '9007199254740991';
let _ptCatalog = null;        // array de items da API
let _ptCatalogBySlug = null;  // Map slug -> item

// Freio adaptativo compartilhado entre os workers PT — evita estourar o rate
// limit da API. Quando um worker leva 429/503, TODOS recuam juntos (cooldown
// global com backoff crescente + jitter) e voltam a acelerar quando libera.
let _ptCooldownUntil = 0;
let _ptBackoff = 0;
async function ptApiFetch(url, attempt = 0) {
  const wait = _ptCooldownUntil - Date.now();
  if (wait > 0) await sleep(wait + Math.floor(Math.random() * 250));
  try {
    const body = await fetchUrl(url);
    if (_ptBackoff > 0) _ptBackoff = Math.max(0, _ptBackoff - 300); // relaxa aos poucos
    return body;
  } catch (e) {
    if (e.message && e.message.startsWith('RATE_LIMIT') && attempt < 7) {
      _ptBackoff = Math.min((_ptBackoff || 800) * 1.7, 20000);
      _ptCooldownUntil = Date.now() + _ptBackoff;
      log('pt', `⏳ Rate limit — recuando ~${Math.round(_ptBackoff / 1000)}s`, 'warn');
      await sleep(_ptBackoff + Math.floor(Math.random() * 400));
      return ptApiFetch(url, attempt + 1);
    }
    throw e;
  }
}

async function fetchPtCatalog() {
  const body = await ptApiFetch(`${API_PT}/api/manga?page=1&limit=${PT_LIMIT}`);
  const json = JSON.parse(body);
  if (!json || !json.success || !json.data || !Array.isArray(json.data.data)) {
    throw new Error('Resposta inesperada do catálogo PT');
  }
  _ptCatalog = json.data.data;
  _ptCatalogBySlug = new Map();
  for (const it of _ptCatalog) { if (it.slug) _ptCatalogBySlug.set(it.slug, it); }
  return _ptCatalog;
}

function ptCover(slug) { return `${CDN_PT}${slug}/cover-md.webp`; }
function ptGenres(item) {
  if (Array.isArray(item.genres) && item.genres.length) return item.genres.map(g => (g && g.name) ? g.name : g).filter(Boolean);
  return ['Manhwa'];
}
function ptAuthor(item) {
  if (Array.isArray(item.authors) && item.authors.length && item.authors[0].name) return item.authors[0].name.trim();
  return 'Desconhecido';
}
function ptLatestInline(item) {
  if (!Array.isArray(item.chapters) || !item.chapters.length) return null;
  let max = -Infinity;
  for (const c of item.chapters) { const n = parseFloat(c.chapterNumber); if (!isNaN(n) && n > max) max = n; }
  return max === -Infinity ? null : max;
}
async function fetchPtChapterNumbers(mangaId) {
  const body = await ptApiFetch(`${API_PT}/api/chapter/get-by-manga-id?mangaId=${mangaId}&page=1&limit=${PT_LIMIT}`);
  const json = JSON.parse(body);
  if (json && json.success && json.data && Array.isArray(json.data.data)) {
    return json.data.data.map(ch => String(ch.chapterNumber)).sort((a, b) => parseFloat(a) - parseFloat(b));
  }
  return [];
}

// ── Feed global de capítulos (todos os mangás de uma vez) ─────────────────────
const PT_FEED_WINDOW = 3000; // capítulos recentes buscados no modo incremental
let _ptFeedGrouped = null;   // Map slug -> [{number,title,date}]

async function fetchPtChapterFeed(page, limit) {
  const body = await ptApiFetch(`${API_PT}/api/chapter/latest?page=${page}&limit=${limit}`);
  const json = JSON.parse(body);
  if (json && json.success && json.data && Array.isArray(json.data.chapters)) return json.data.chapters;
  return [];
}
function groupPtFeed(feed) {
  const map = new Map();
  for (const ch of feed) {
    const slug = ch.manga && ch.manga.slug;
    if (!slug) continue;
    if (!map.has(slug)) map.set(slug, []);
    map.get(slug).push({ number: ch.chapterNumber, title: ch.title, date: ch.releaseDate });
  }
  return map;
}

// Descrição (HTML) — usada só para mangá novo, para não baixar HTML à toa
async function fetchPtDescription(slug, title) {
  try {
    const html = await fetchUrl(`${BASE_PT}/manga/${slug}`);
    const descM = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    return cleanDesc(descM ? descM[1] : `Leia ${title} online.`);
  } catch (e) { return `Leia ${title} online.`; }
}

function extractRsc(html) {
  const matches = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) || [];
  return matches.map(m => {
    const c = m.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/);
    return c ? c[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t') : '';
  }).join('');
}

function cleanDesc(raw) {
  return (raw || '')
    .replace(/,?\s*online\s+gr[aá]tis\s+no\s+Leitura\s+Manga\.?/gi, '.')
    .replace(/\s*Acompanhe\s+cap[ií]tulos.{0,60}qualidade\.?/gi, '')
    .replace(/\s*Leitura\s+Manga\.?/gi, '.')
    .replace(/\.{2,}/g, '.').trim();
}

// Versão rápida: metadados do catálogo da API + capítulos da API. Sem baixar HTML.
// description = null → o worker NÃO sobrescreve descrições já existentes.
async function fetchPtDetails(slug) {
  const item = _ptCatalogBySlug && _ptCatalogBySlug.get(slug);
  if (item) {
    // Capítulos vêm do feed global (sem chamada por mangá). Fallback: API por id.
    let chapters;
    if (_ptFeedGrouped) {
      chapters = _ptFeedGrouped.get(slug) || [];
    } else {
      chapters = (await fetchPtChapterNumbers(item._id)).map(n => ({ number: n, title: `Capítulo ${n}`, date: null }));
    }
    return {
      _id: item._id,
      title: item.title || slug,
      description: null,
      cover: ptCover(slug),
      genres: ptGenres(item),
      author: ptAuthor(item),
      year: item.releaseYear || null,
      status: item.status === 2 ? 'completed' : 'ongoing',
      chapters
    };
  }
  // Fallback: método HTML antigo (slug não presente no catálogo da API)
  return fetchPtDetailsHtml(slug);
}

async function fetchPtDetailsHtml(slug) {
  const html = await fetchUrl(`${BASE_PT}/manga/${slug}`);
  const rsc  = extractRsc(html);

  const titleM = html.match(/<h1[^>]*class="[^"]*font-bold[^"]*"[^>]*>([^<]+)<\/h1>/) || rsc.match(/"title"\s*:\s*"([^"]+)"/);
  const title  = titleM ? titleM[1].trim() : slug;

  const descM       = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  const description = cleanDesc(descM ? descM[1] : `Leia ${title} online.`);

  const coverM = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  const cover  = coverM ? coverM[1] : `${CDN_PT}${slug}/cover-md.webp`;

  // Gêneros — bloco "genres" no RSC (objeto, não sidebar)
  const genres = [];
  const gb = rsc.match(/"genres"\s*:\s*\[(\{[^\]]*)\]/);
  if (gb) {
    (gb[1].match(/"name"\s*:\s*"([^"]+)"/g) || []).forEach(item => {
      const g = item.replace(/^"name"\s*:\s*"/, '').replace(/"$/, '').trim();
      if (g && !genres.includes(g)) genres.push(g);
    });
  }

  // Autor — bloco "authors" no RSC
  let author = 'Desconhecido';
  const ab = rsc.match(/"authors"\s*:\s*\[(\{[^\]]*)\]/);
  if (ab) { const an = ab[1].match(/"name"\s*:\s*"([^"]+)"/); if (an) author = an[1].trim(); }

  // Capítulos: tenta pela API oficial do LeituraManga usando o mangaId extraído do RSC
  let chNums = [];
  const idMatch = rsc.match(/"mangaId"\s*:\s*"([a-f0-9]{24})"/);
  if (idMatch) {
    try {
      const mangaId = idMatch[1];
      const apiRes = await fetchUrl(`https://api.leituramanga.net/api/chapter/get-by-manga-id?mangaId=${mangaId}&page=1&limit=9007199254740991`);
      const apiJson = JSON.parse(apiRes);
      if (apiJson.success && apiJson.data && Array.isArray(apiJson.data.data)) {
        chNums = apiJson.data.data
          .map(ch => String(ch.chapterNumber))
          .sort((a, b) => parseFloat(a) - parseFloat(b));
      }
    } catch(e) {
      log('pt', `⚠️ Erro ao buscar capítulos da API para ${slug}: ${e.message}`, 'warn');
    }
  }

  // Fallback clássico por Regex caso a API falhe ou o mangaId não seja encontrado
  if (chNums.length === 0) {
    const chR    = new RegExp(`/manga/${slug}/chapter/([\\d.]+)`, 'g');
    chNums = [...new Set([...(rsc.match(chR) || []), ...(html.match(chR) || [])])]
      .map(m => m.split('/chapter/')[1])
      .sort((a, b) => parseFloat(a) - parseFloat(b));
  }

  const chapters = chNums.map(n => ({ number: n, title: `Capítulo ${n}`, date: null }));
  return { title, description, cover, genres: genres.length > 0 ? genres : ['Manhwa'], author, chapters };
}

async function fetchPtChapterPages(slug, chNum) {
  // Igual ao leituramanga-scraper.cjs: extrai "images":[{"url":"..."}] do RSC
  const html = await fetchUrl(`${BASE_PT}/manga/${slug}/chapter/${chNum}`);
  const rsc  = extractRsc(html);
  const imagesM = rsc.match(/"images"\s*:\s*\[([\s\S]*?)\]/);
  if (!imagesM) return [];
  const pages = [];
  let m;
  const urlR = /"url"\s*:\s*"([^"]+)"/g;
  while ((m = urlR.exec(imagesM[1])) !== null) pages.push(CDN_PT + m[1]);
  return pages;
}

async function fetchMlChapterPages(mlId) {
  try {
    const body = await fetchUrl(`${API_ML}/media?parent=${mlId}&per_page=100`);
    const media = JSON.parse(body);
    if (!Array.isArray(media)) return [];
    
    // Sort ascending by page number in filename
    const sorted = media.map(m => m.source_url).sort((a, b) => {
      const getPageNum = (url) => {
        const filename = url.substring(url.lastIndexOf('/') + 1);
        const numMatch = filename.match(/^(\d+)/);
        return numMatch ? parseInt(numMatch[1], 10) : 0;
      };
      return getPageNum(a) - getPageNum(b);
    });
    return sorted;
  } catch (e) {
    log('pt', `⚠️ Erro ao buscar páginas do MangaLivre para o ID ${mlId}: ${e.message}`, 'warn');
    return [];
  }
}

function decodeEntities(str) {
  return (str || '')
    .replace(/&#8211;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseMlChapterTitle(renderedTitle, slug) {
  const titleDecoded = decodeEntities(renderedTitle);
  let mangaTitle = '';
  let chapterPart = '';
  
  const dashParts = titleDecoded.split(/\s*(?:–|—)\s*/);
  if (dashParts.length >= 2) {
    mangaTitle = dashParts[0].trim();
    chapterPart = dashParts[1].trim();
  } else {
    const hyphenParts = titleDecoded.split(/\s+-\s+/);
    if (hyphenParts.length >= 2) {
      mangaTitle = hyphenParts[0].trim();
      chapterPart = hyphenParts[1].trim();
    } else {
      mangaTitle = titleDecoded;
      chapterPart = '';
    }
  }

  const numMatch = chapterPart.match(/(?:Capítulo|Cap)\s*([\d.]+)/i) || titleDecoded.match(/(?:Capítulo|Cap)\s*([\d.]+)/i);
  const chapterNumber = numMatch ? parseFloat(numMatch[1]) : null;

  let mangaSlug = '';
  const capituloIdx = slug.indexOf('-capitulo-');
  if (capituloIdx > 0) {
    mangaSlug = slug.substring(0, capituloIdx);
  } else {
    mangaSlug = mangaTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  return { mangaTitle, mangaSlug, chapterNumber };
}

async function fetchMlMangaDetailsHtml(slug, defaultTitle) {
  try {
    const url = `${BASE_ML}/manga/${slug}/`;
    const html = await fetchUrl(url);
    
    const titleMatch = html.match(/<h1 class="manga-title">([\s\S]*?)<\/h1>/i);
    let title = defaultTitle;
    if (titleMatch) {
      title = titleMatch[1].replace(/<div class="manga-language-flag"[\s\S]*?<\/div>/i, '').replace(/<[^>]+>/g, '').trim();
    }
    
    const descMatch = html.match(/<div class="synopsis-content">([\s\S]*?)<\/div>/i);
    let description = `Leia ${title} online em português no MangaLivre.`;
    if (descMatch) {
      description = descMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }
    
    const coverMatch = html.match(/<div class="manga-cover">[\s\S]*?<img[^>]+src="([^"]+)"/i);
    let cover = `${BASE_ML}/wp-content/uploads/covers/${slug}.jpg`;
    if (coverMatch) {
      cover = coverMatch[1];
    }
    
    const genres = [];
    const genreRegex = /<span class="manga-tag">([^<]+)<\/span>/gi;
    let gMatch;
    while ((gMatch = genreRegex.exec(html)) !== null) {
      const g = gMatch[1].trim();
      if (g && !genres.includes(g)) genres.push(g);
    }
    
    function getMetaValue(label) {
      const regex = new RegExp(`<span class="meta-label">${label}:<\\/span>\\s*<span class="meta-value">([^<]+)<\\/span>`, 'i');
      const m = html.match(regex);
      return m ? m[1].trim() : null;
    }
    
    const author = getMetaValue('Autor') || 'Desconhecido';
    const artist = getMetaValue('Artista') || author;
    const yearStr = getMetaValue('Ano');
    const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
    const statusStr = getMetaValue('Status');
    const status = (statusStr && statusStr.toLowerCase().includes('lançamento')) ? 'ongoing' : 'completed';

    return {
      title,
      description,
      cover,
      genres: genres.length > 0 ? genres : ['Manga'],
      author,
      artist,
      year,
      status
    };
  } catch (e) {
    return {
      title: defaultTitle,
      description: `Leia ${defaultTitle} online em português.`,
      cover: `https://placehold.co/300x400/1a1a1a/666?text=${encodeURIComponent(defaultTitle)}`,
      genres: ['Manga'],
      author: 'Desconhecido',
      artist: 'Desconhecido',
      year: new Date().getFullYear(),
      status: 'ongoing'
    };
  }
}

// Extrai a lista EXATA de imagens de uma página de capítulo do MangaFreak.
// As páginas ficam em images.mangafreak.me/mangas/...  (a capa fica em /manga_images/).
function extractMfPageImages(html) {
  const urls = [...new Set((html.match(/https?:\/\/images\.mangafreak\.me\/mangas\/[^"'\s)]+\.(?:jpe?g|png|webp)/gi) || []))];
  urls.sort((a, b) => {
    const na = parseInt((a.match(/_(\d+)\.[a-z]+$/i) || [])[1] || '0', 10);
    const nb = parseInt((b.match(/_(\d+)\.[a-z]+$/i) || [])[1] || '0', 10);
    return na - nb;
  });
  return urls;
}

// Resolve as páginas de um capítulo EN buscando a página do leitor do MangaFreak.
// slug = slug do MangaFreak (ex.: Berserk, One_Piece).
async function fetchEnChapterPages(slug, chNum) {
  const esc = String(slug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escCh = String(chNum).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1) Tenta direto o padrão Read1_Slug_Cap
  try {
    const html = await fetchUrl(`${BASE_EN}/Read1_${slug}_${chNum}`);
    const imgs = extractMfPageImages(html);
    if (imgs.length > 0) return imgs;
  } catch (e) {}

  // 2) Fallback: acha o link real /ReadN_Slug_Cap na página do mangá
  try {
    const mangaHtml = await fetchUrl(`${BASE_EN}/Manga/${slug}`);
    const linkM = mangaHtml.match(new RegExp(`/Read\\d+_${esc}_${escCh}\\b`));
    if (linkM) {
      const html = await fetchUrl(`${BASE_EN}${linkM[0]}`);
      return extractMfPageImages(html);
    }
  } catch (e) {}

  return [];
}

// Incremental: a fila são os mangás que aparecem no feed recente de capítulos.
// (O merge ignora capítulos já existentes, então só os realmente novos entram.)
async function collectPtLatestSlugs(signal, delay) {
  log('pt', '📋 Lendo feed de capítulos recentes...');
  const slugs = _ptFeedGrouped ? [..._ptFeedGrouped.keys()] : [];
  state.pt.queue = slugs;
  state.pt.total = slugs.length;
  log('pt', `  ${slugs.length} mangás com atividade recente.`);
  saveState();
}

// Completo: enfileira todos os slugs do catálogo da API.
async function collectPtSlugs(signal, delay) {
  log('pt', '📋 Mapeando catálogo completo via API...');
  const slugSet = new Set(state.pt.queue);
  for (const item of _ptCatalog) { if (item.slug) slugSet.add(item.slug); }
  state.pt.queue = [...slugSet];
  state.pt.total = state.pt.queue.length;
  log('pt', `✅ ${state.pt.queue.length} slugs no catálogo.`);
  saveState();
}

async function ptWorker(workerId, signal, delay) {
  const { data } = getMangaData();
  while (state.pt.queue.length > 0 && !signal.aborted) {
    const slug = state.pt.queue.shift();
    if (!slug) break;
    state.pt.current[workerId] = slug;
    broadcastState();
    try {
      if (delay > 0) await sleep(delay + workerId * 20);
      const details = await fetchPtDetails(slug);
      let manga = findManga(details.title, slug);
      let mangaId = slug;

      if (!manga) {
        const description = details.description || await fetchPtDescription(slug, details.title);
        manga = {
          id: slug, slug, title: details.title, altTitle: '',
          cover: details.cover, banner: details.cover,
          author: details.author, artist: details.author,
          status: details.status || 'ongoing', year: details.year || new Date().getFullYear(),
          rating: 7.0, genres: details.genres,
          description: description, descriptionPt: description, chaptersCount: 0,
          lang: 'pt', hasPt: true, hasEn: false
        };
        data.push(manga);
        log('pt', `✨ [W${workerId+1}] Novo: ${details.title}`);
      } else {
        manga.hasPt = true;
        if (details.description) manga.descriptionPt = details.description; // preserva descrição existente
        if (details.genres.length > 0 && details.genres[0] !== 'Manhwa') manga.genres = details.genres;
        if (details.author !== 'Desconhecido' && (!manga.author || manga.author === 'Desconhecido')) {
          manga.author = details.author; manga.artist = details.author;
        }
        mangaId = manga.id;
        log('pt', `🔗 [W${workerId+1}] ${details.title}`);
      }

      // Capítulos PT
      const chapObj = loadChaptersFile(mangaId);
      if (!chapObj.pt) chapObj.pt = [];
      const existing = new Set(chapObj.pt.map(c => String(c.number)));
      const toGet    = details.chapters.filter(e => !existing.has(String(e.number)));

      if (toGet.length > 0) {
        log('pt', `  📥 [W${workerId+1}] ${toGet.length} cap(s) novos em ${details.title}`);
        for (const e of toGet) {
          chapObj.pt.push({
            id: `${mangaId}-chapter-${e.number}`,
            number: parseFloat(e.number),
            title: e.title || `Capítulo ${e.number}`,
            date: e.date || new Date().toISOString(),
            pages: []
          });
        }
        chapObj.pt.sort((a, b) => a.number - b.number);
        manga.chaptersCount = Math.max(manga.chaptersCount || 0, chapObj.pt.length);
        saveChaptersFile(mangaId, chapObj);
      }

      state.pt.processed++;
      updateSubStep('pt', 'leituramanga', { processed: state.pt.processed });
      scheduleSave(); saveState();
    } catch(e) {
      if (e.message === 'Aborted') throw e;
      if (e.message.startsWith('RATE_LIMIT')) {
        log('pt', `  ⏳ Rate limit, aguardando 8s...`, 'warn');
        state.pt.queue.unshift(slug); await sleep(8000);
      } else {
        log('pt', `❌ [W${workerId+1}] ${slug}: ${e.message}`, 'error');
        state.pt.errors++; state.pt.processed++;
        updateSubStep('pt', 'leituramanga', { processed: state.pt.processed });
        saveState();
      }
    }
    state.pt.current[workerId] = '';
  }
}

async function runMlScrapePart(signal, mode) {
  const { data } = getMangaData();
  const mlStep = state.pt.subSteps && state.pt.subSteps.find(step => step.id === 'mangalivre');
  const mlProcessed = mlStep ? mlStep.processed : 0;
  const startPage = mlProcessed > 0 ? mlProcessed : 1;
  const perPage = 100;
  const FIELDS = '_fields=id,slug,title,date_gmt';
  let totalProcessed = 0;

  state.pt.current = ['Lendo feed MangaLivre...', '', '', ''];
  updateSubStep('pt', 'mangalivre', { status: 'running', processed: 0, total: 0 });
  broadcastState();

  // ── Phase 1: Collect all chapters ────────────────────────────────────────
  let allChapters = [];

  if (mode === 'incremental') {
    // Incremental: small batches, early-stop when no new content
    const batchSize = 3;
    const maxPages = startPage + 2;
    let page = startPage;

    while (page <= maxPages && !signal.aborted) {
      const pagesToFetch = [];
      for (let i = 0; i < batchSize && (page + i) <= maxPages; i++) pagesToFetch.push(page + i);
      log('pt', `📡 MangaLivre: Páginas [${pagesToFetch.join(', ')}] em paralelo...`);

      const batchResults = await Promise.all(pagesToFetch.map(p =>
        fetchUrl(`${API_ML}/chapter?page=${p}&per_page=${perPage}&${FIELDS}`)
          .then(body => ({ page: p, data: JSON.parse(body) }))
          .catch(e => ({ page: p, error: e }))
      ));
      batchResults.sort((a, b) => a.page - b.page);

      let batchEmpty = false;
      for (const res of batchResults) {
        if (res.error || !Array.isArray(res.data) || res.data.length === 0) { batchEmpty = true; }
        else allChapters = allChapters.concat(res.data);
      }
      if (batchEmpty) break;
      page += batchSize;
      updateSubStep('pt', 'mangalivre', { processed: page - 1 });
    }
  } else {
    // Full catalog: discover total pages via X-WP-TotalPages header, then parallel pool
    log('pt', '📡 MangaLivre: Página 1 — descobrindo total de páginas...');
    let firstPage = [], totalPages = 1;
    try {
      const { body, headers } = await fetchUrlWithHeaders(`${API_ML}/chapter?page=1&per_page=${perPage}&${FIELDS}`);
      firstPage = JSON.parse(body);
      totalPages = parseInt(headers['x-wp-totalpages'] || '1', 10);
    } catch (e) {
      log('pt', `⚠️ MangaLivre: Erro ao buscar página 1: ${e.message}`, 'warn');
      updateSubStep('pt', 'mangalivre', { status: 'done' });
      return;
    }
    log('pt', `📦 MangaLivre: ${totalPages} páginas (≈${totalPages * perPage} capítulos). Baixando todas em paralelo (20 workers)...`);
    updateSubStep('pt', 'mangalivre', { total: totalPages, processed: 1 });

    if (Array.isArray(firstPage)) allChapters.push(...firstPage);

    if (totalPages > 1 && !signal.aborted) {
      const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const pageResults = new Array(remaining.length).fill(null);
      let nextIdx = 0;
      const poolWorkers = Array.from({ length: Math.min(20, remaining.length) }, async () => {
        while (nextIdx < remaining.length && !signal.aborted) {
          const idx = nextIdx++;
          const p = remaining[idx];
          try {
            const body = await fetchUrl(`${API_ML}/chapter?page=${p}&per_page=${perPage}&${FIELDS}`);
            const parsed = JSON.parse(body);
            if (Array.isArray(parsed)) pageResults[idx] = parsed;
          } catch (e) {
            log('pt', `⚠️ MangaLivre: Erro pág. ${p}: ${e.message}`, 'warn');
          }
          if (idx % 10 === 0) updateSubStep('pt', 'mangalivre', { processed: p });
        }
      });
      await Promise.all(poolWorkers);
      for (const r of pageResults) { if (r) allChapters.push(...r); }
    }
  }

  if (signal.aborted) return;
  log('pt', `✅ MangaLivre: ${allChapters.length} capítulos carregados. Processando...`);

  // ── Phase 2: Process all collected chapters ──────────────────────────────
  const grouped = new Map();
  for (const c of allChapters) {
    const { mangaTitle, mangaSlug, chapterNumber } = parseMlChapterTitle(c.title.rendered, c.slug);
    if (!mangaSlug || chapterNumber === null) continue;
    if (!grouped.has(mangaSlug)) grouped.set(mangaSlug, { mangaTitle, chapters: [] });
    grouped.get(mangaSlug).chapters.push({
      renderedTitle: c.title.rendered,
      chapterNumber,
      dateGmt: c.date_gmt,
      id: c.id
    });
  }

  // Identifica e busca novos mangás em paralelo
  const newMangasToFetch = [];
  for (const [mSlug, info] of grouped.entries()) {
    if (!findManga(info.mangaTitle, mSlug)) newMangasToFetch.push({ slug: mSlug, defaultTitle: info.mangaTitle });
  }

  if (newMangasToFetch.length > 0 && !signal.aborted) {
    log('pt', `✨ MangaLivre: ${newMangasToFetch.length} novos mangás detectados. Buscando detalhes em paralelo...`);
    let nextIdx = 0;
    await Promise.all(Array.from({ length: Math.min(5, newMangasToFetch.length) }, async () => {
      while (nextIdx < newMangasToFetch.length && !signal.aborted) {
        const item = newMangasToFetch[nextIdx++];
        state.pt.current = [`Buscando detalhes: ${item.defaultTitle}`, '', '', ''];
        broadcastState();
        try {
          const details = await fetchMlMangaDetailsHtml(item.slug, item.defaultTitle);
          data.push({
            id: item.slug, slug: item.slug, title: details.title, altTitle: '',
            cover: details.cover, banner: details.cover,
            author: details.author, artist: details.author,
            status: details.status, year: details.year, rating: 7.0,
            genres: details.genres, description: details.description, descriptionPt: details.description,
            chaptersCount: 0, lang: 'pt', hasPt: true, hasEn: false
          });
          log('pt', `✨ MangaLivre: Detalhes carregados para ${details.title}`);
        } catch (e) {
          log('pt', `⚠️ MangaLivre: Erro ao buscar detalhes de ${item.defaultTitle}: ${e.message}`, 'warn');
        }
      }
    }));
    if (signal.aborted) return;
  }

  // Processa os capítulos agrupados
  let pageAdded = 0, pageUpdated = 0;
  for (const [mSlug, info] of grouped.entries()) {
    if (signal.aborted) break;
    const m = findManga(info.mangaTitle, mSlug);
    if (!m) continue;

    m.hasPt = true;
    state.pt.current = [`Processando: ${m.title}`, '', '', ''];
    broadcastState();

    const chapObj = loadChaptersFile(m.id);
    if (!chapObj.pt) chapObj.pt = [];
    let mangaFileChanged = false;

    for (const ch of info.chapters) {
      const existingIdx = chapObj.pt.findIndex(existing => String(existing.number) === String(ch.chapterNumber));
      const chapterDate = ch.dateGmt + 'Z';

      if (existingIdx < 0) {
        chapObj.pt.push({
          id: `${m.id}-chapter-${ch.chapterNumber}`,
          number: ch.chapterNumber,
          title: decodeEntities(ch.renderedTitle),
          date: chapterDate,
          pages: [],
          src: 'mangalivre',
          mlId: ch.id
        });
        mangaFileChanged = true;
        pageAdded++; totalProcessed++;
        log('pt', `  📥 ${m.title}: +Cap ${ch.chapterNumber} (MangaLivre)`);
      } else {
        const existingCh = chapObj.pt[existingIdx];
        const existingDate = new Date(existingCh.date).getTime();
        const incomingDate = new Date(chapterDate).getTime();
        if (!isNaN(incomingDate) && (isNaN(existingDate) || incomingDate > existingDate || !existingCh.src)) {
          existingCh.title = decodeEntities(ch.renderedTitle);
          existingCh.date = chapterDate;
          existingCh.src = 'mangalivre';
          existingCh.mlId = ch.id;
          existingCh.pages = [];
          mangaFileChanged = true;
          pageUpdated++; totalProcessed++;
          log('pt', `  🔄 ${m.title}: Cap ${ch.chapterNumber} atualizado para MangaLivre (mais recente)`);
        }
      }
    }

    if (mangaFileChanged) {
      chapObj.pt.sort((a, b) => a.number - b.number);
      m.chaptersCount = Math.max(m.chaptersCount || 0, chapObj.pt.length);
      saveChaptersFile(m.id, chapObj);
    }
  }

  scheduleSave();
  if (!signal.aborted) {
    updateSubStep('pt', 'mangalivre', { status: 'done', processed: allChapters.length, total: allChapters.length });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  H20 SCRAPER — hentai20.io (+18 EN)
//  WordPress / Madara theme — scraping HTML com gzip support
//  Conteúdo EN +18: hasEn:true, lang:'en', genres inclui 'Hentai'
// ══════════════════════════════════════════════════════════════════════════════

function fetchH20Url(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': BASE_H20 + '/'
      },
      timeout: 30000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchH20Url(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 403) return reject(new Error('CF_BLOCKED:403'));
      if (res.statusCode === 404) return reject(new Error('NOT_FOUND:404'));
      if (res.statusCode === 429 || res.statusCode === 503) return reject(new Error(`RATE_LIMIT:${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          let text;
          if (enc === 'gzip') text = zlib.gunzipSync(buf).toString('utf8');
          else if (enc === 'deflate') text = zlib.inflateSync(buf).toString('utf8');
          else if (enc === 'br') text = zlib.brotliDecompressSync(buf).toString('utf8');
          else text = buf.toString('utf8');
          resolve(text);
        } catch (e) { resolve(buf.toString('utf8')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseH20ListPage(html) {
  const slugs = new Set();
  const SKIP = new Set(['page', 'list-mode', 'manga-genre', 'wp-content', 'wp-includes', 'wp-admin']);
  for (const m of html.matchAll(/href="https?:\/\/hentai20\.io\/manga\/([^/"#]+)\/"/gi)) {
    const s = m[1];
    if (s && s.length > 2 && !SKIP.has(s) && !s.startsWith('wp-')) slugs.add(s);
  }
  const nums = [...html.matchAll(/href="[^"]*\/manga\/page\/(\d+)\/"/gi)].map(m => parseInt(m[1]));
  const totalPages = nums.length > 0 ? Math.max(...nums) : 1;
  return { slugs: [...slugs], totalPages };
}

function parseH20Post(html) {
  // Título: og:title → strip sufixo do site
  let title = '';
  const ogT = html.match(/<meta[^>]+property="og:title"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
  if (ogT) {
    title = decodeEntities(ogT[1])
      .replace(/\s*[-–|]\s*(hentai20\.io|Read.*Online).*$/i, '').trim();
  }
  if (!title) {
    const h1 = html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>\s*([^<]+)/i);
    if (h1) title = decodeEntities(h1[1].trim());
  }

  // Capa: og:image → .summary_image
  let cover = '';
  const ogImg = html.match(/<meta[^>]+property="og:image"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
  if (ogImg) cover = ogImg[1];
  if (!cover) {
    const sm = html.match(/<div[^>]*class="[^"]*summary_image[^"]*"[^>]*>[\s\S]{0,500}?<img[^>]+src="([^"]+)"/i);
    if (sm) cover = sm[1];
  }

  // Sinopse: og:description → .description-summary
  let description = '';
  const ogD = html.match(/<meta[^>]+property="og:description"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+name="description"\s+content="([^"]+)"/i);
  if (ogD) description = decodeEntities(ogD[1].trim());

  // Gêneros: Madara — links /manga-genre/, /genre/, /tag/
  const genreRefs = [
    ...html.matchAll(/href="[^"]*\/manga-genre\/[^"/"]*\/"[^>]*>\s*([^<]+)\s*<\/a>/gi),
    ...html.matchAll(/href="[^"]*\/genres?\/[^"/"]*\/"[^>]*>\s*([^<]+)\s*<\/a>/gi),
    ...html.matchAll(/href="[^"]*\/tag\/[^"/"]*\/"[^>]*>\s*([^<]+)\s*<\/a>/gi)
  ];
  const genres = [...new Set(
    genreRefs.map(m => decodeEntities(m[1].trim())).filter(g => g.length > 1 && g.length < 50)
  )];
  if (genres.length === 0) genres.push('Hentai');
  if (!genres.some(g => g.toLowerCase().includes('hentai'))) genres.unshift('Hentai');

  // Status
  const stM = html.match(/(Ongoing|Completed|On-Going|Complete)/i);
  const status = stM && !stM[1].toLowerCase().includes('complet') ? 'ongoing' : 'completed';

  // Capítulos (Madara: links /manga/{slug}/{chapter-slug}/)
  const chapRefs = [...html.matchAll(/<a[^>]+href="(https?:\/\/hentai20\.io\/manga\/[^"]+\/[^"]+\/)"[^>]*>\s*([^<]+)/gi)];
  const chapters = chapRefs.map(m => ({ url: m[1], title: decodeEntities(m[2].trim()) }))
    .filter(c => !c.url.endsWith('/manga/' + c.url.split('/manga/')[1].split('/')[0] + '/'));

  return { title, cover, description, genres, status, chapters };
}

async function fetchH20ChapterPages(chapterUrl) {
  try {
    const html = await fetchH20Url(chapterUrl);
    const pages = [];
    // Madara: .wp-manga-chapter-img com data-src ou src
    for (const m of html.matchAll(/<img[^>]+class="[^"]*wp-manga-chapter-img[^"]*"[^>]+(?:data-src|src)="([^"]+)"/gi)) {
      if (m[1] && !m[1].includes('data:image')) pages.push(m[1].trim());
    }
    if (pages.length === 0) {
      // Fallback: qualquer data-src dentro de .reading-content
      const rdM = html.match(/<div[^>]*class="[^"]*reading-content[^"]*"[^>]*>([\s\S]+?)<div[^>]*class="[^"]*nav-links/i);
      if (rdM) {
        for (const pm of rdM[1].matchAll(/data-src="([^"]+)"/gi)) {
          if (!pm[1].includes('data:image')) pages.push(pm[1].trim());
        }
      }
    }
    return [...new Set(pages)];
  } catch (e) { return []; }
}

async function runH20Scrape(signal, mode) {
  const { data } = getMangaData();
  updateSubStep('en', 'hentai20', { status: 'running', processed: 0, total: 0 });
  broadcastState();

  const existingSlugs = new Set(data.filter(m => m.source === 'hentai20').map(m => m.id));
  let newAdded = 0;
  const maxPages = mode === 'incremental' ? 3 : 9999;
  const allSlugs = new Set();

  // Fase A: descobre slugs nas páginas de listagem
  try {
    const html1 = await fetchH20Url(`${BASE_H20}/manga/?m_orderby=latest`);
    const { slugs: s1, totalPages: tp } = parseH20ListPage(html1);
    s1.forEach(s => allSlugs.add(s));
    const totalPages = Math.min(tp, maxPages);
    log('en', `  Hentai20: ${totalPages} pág(s), ${allSlugs.size} slug(s) na pág. 1.`);
    updateSubStep('en', 'hentai20', { total: totalPages });

    if (totalPages > 1) {
      let nextP = 2;
      await Promise.all(Array.from({ length: Math.min(10, totalPages - 1) }, async () => {
        while (nextP <= totalPages && !signal.aborted) {
          const p = nextP++;
          try {
            const html = await fetchH20Url(`${BASE_H20}/manga/page/${p}/?m_orderby=latest`);
            parseH20ListPage(html).slugs.forEach(s => allSlugs.add(s));
          } catch (e) { log('en', `⚠️ Hentai20: Erro pág.${p}: ${e.message}`, 'warn'); }
          await sleep(250);
        }
      }));
    }
  } catch (e) {
    log('en', `⚠️ Hentai20: Falha ao listar catálogo: ${e.message}`, 'warn');
    updateSubStep('en', 'hentai20', { status: 'done', newAdded: 0 });
    return;
  }

  if (signal.aborted) return;

  // Fase B: processa apenas slugs novos
  const newSlugs = [...allSlugs].filter(s => !existingSlugs.has(s));
  log('en', `  Hentai20: ${allSlugs.size} total, ${newSlugs.length} novos.`);
  updateSubStep('en', 'hentai20', { total: newSlugs.length, processed: 0 });

  let nextIdx = 0;
  await Promise.all(Array.from({ length: Math.min(5, newSlugs.length || 1) }, async () => {
    while (nextIdx < newSlugs.length && !signal.aborted) {
      const slug = newSlugs[nextIdx++];
      if (state.en.current) state.en.current[0] = `Hentai20: ${slug}`;
      broadcastState();
      try {
        const html = await fetchH20Url(`${BASE_H20}/manga/${slug}/`);
        const { title, cover, description, genres, status, chapters } = parseH20Post(html);
        if (!title) { log('en', `⚠️ Hentai20: sem título em ${slug}`, 'warn'); continue; }

        const mangaEntry = {
          id: slug, slug, title, altTitle: '',
          cover, banner: cover,
          author: 'Unknown', artist: 'Unknown',
          status, year: new Date().getFullYear(), rating: 0,
          genres, description, descriptionEn: description,
          chaptersCount: Math.max(chapters.length, 1),
          lang: 'en', hasPt: false, hasEn: true,
          source: 'hentai20'
        };

        if (chapters.length > 1) {
          // Série com múltiplos capítulos
          const chapList = chapters.map((ch, i) => {
            const nm = ch.title.match(/(\d+(?:\.\d+)?)/);
            const num = nm ? parseFloat(nm[1]) : i + 1;
            return { id: `${slug}-ch-${num}`, number: num, title: ch.title, date: new Date().toISOString(), pages: [], src: 'hentai20', chapterUrl: ch.url };
          }).sort((a, b) => a.number - b.number);
          mangaEntry.chaptersCount = chapList.length;
          saveChaptersFile(slug, { en: chapList });
        } else {
          // Doujinshi single-chapter — busca páginas imediatamente
          const chUrl = chapters.length === 1 ? chapters[0].url : `${BASE_H20}/manga/${slug}/chapter-1/`;
          const pages = await fetchH20ChapterPages(chUrl);
          await sleep(300);
          saveChaptersFile(slug, { en: [{
            id: `${slug}-chapter-1`, number: 1,
            title: chapters.length > 0 ? chapters[0].title : 'Complete',
            date: new Date().toISOString(),
            pages, src: 'hentai20', chapterUrl: chUrl
          }]});
          mangaEntry.chaptersCount = 1;
        }

        data.push(mangaEntry);
        existingSlugs.add(slug);
        log('en', `  ✨ Hentai20: +${title} (${mangaEntry.chaptersCount} cap(s))`);
        newAdded++;
        updateSubStep('en', 'hentai20', { processed: newAdded, newAdded });
      } catch (e) {
        log('en', `⚠️ Hentai20: Erro em ${slug}: ${e.message}`, 'warn');
      }
      await sleep(300);
    }
  }));

  scheduleSave();
  if (!signal.aborted) {
    log('en', `✅ Hentai20: ${newAdded} novos itens adicionados.`, 'success');
    updateSubStep('en', 'hentai20', { status: 'done', newAdded });
    if (state.en.current) state.en.current[0] = '';
    broadcastState();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MH SCRAPER — mundohentaioficial.com
//  HTML scraping (Cloudflare bloqueia WP REST API)
//  Todo conteúdo marcado com genres:['Hentai'] → filtrado pelo modo adulto existente
//  Imagens via /galeria?id={mhId}&img={n} — resolvidas on-demand pelo leitor
// ══════════════════════════════════════════════════════════════════════════════

function fetchMhUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': BASE_MH + '/'
      },
      timeout: 30000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchMhUrl(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 403) return reject(new Error('CF_BLOCKED:403'));
      if (res.statusCode === 404) return reject(new Error('NOT_FOUND:404'));
      if (res.statusCode === 429 || res.statusCode === 503)
        return reject(new Error(`RATE_LIMIT:${res.statusCode}`));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseMhPost(html) {
  // Post ID
  const idMatch = html.match(/data-id="(\d+)"/) || html.match(/download_manga\/(\d+)/) || html.match(/\?p=(\d+)/);
  const mhId = idMatch ? parseInt(idMatch[1]) : null;

  // Contagem de páginas
  const pagesMatch = html.match(/<li><strong>P[aá]ginas?<\/strong>\s*(\d+)<\/li>/i);
  const pageCount = pagesMatch ? parseInt(pagesMatch[1]) : 0;

  // Título: extrai do <title> e remove sufixos do site
  const titleMatch = html.match(/<title>(?:\[[^\]]*\]\s*)?([^|<]+)/i);
  let title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';
  // Remove sufixos comuns: " - Mundo Hentai", " – Mundo Hentai", " | MundoHentai", etc.
  title = title.replace(/\s*[-–|]\s*(Mundo\s*Hentai[^|<]*|MundoHentai[^|<]*)$/i, '').trim();

  // Capa: og:image
  const coverMatch = html.match(/<meta[^>]+property="og:image"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
  const cover = coverMatch ? coverMatch[1] : '';

  // Sinopse/descrição: og:description ou meta description
  const descMatch = html.match(/<meta[^>]+property="og:description"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i)
    || html.match(/<meta[^>]+name="description"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
  const description = descMatch ? decodeEntities(descMatch[1].trim()) : '';

  // Tags
  const tagMatches = [...html.matchAll(/href="https?:\/\/mundohentaioficial\.com\/tag\/[^"]*"\s+rel="tag">([^<]+)<\/a>/g)];
  const tags = tagMatches.map(m => decodeEntities(m[1].trim()));

  // Categorias (de links /category/)
  const catMatches = [...html.matchAll(/href="https?:\/\/mundohentaioficial\.com\/category\/[^"]*"\s+title="([^"]+)"/g)];
  const categories = catMatches.map(m => decodeEntities(m[1].trim()));

  return { mhId, pageCount, title, cover, description, tags, categories };
}
function parseMhListPage(html) {
  // Slugs a excluir (categorias, tags, páginas do sistema)
  const EXCLUDED = new Set([
    'category','tag','page','parodia','cor','personagens','parodias','tags',
    'cadastro','entrar','contato','download_manga','galeria','feed',
    'animes-hentai','manga-hentai','one-shot','hentai-sem-censura',
    'hentai-3d','comics','jav','doujinshi','hentai','netorare',
    'ahegao-hentai','milf','incesto','anal','super-hq','yaoi'
  ]);

  const slugs = new Set();
  for (const m of html.matchAll(/href="https?:\/\/mundohentaioficial\.com\/([\w-]+)\/(?:[^"#?]*)"/g)) {
    const slug = m[1];
    if (
      !EXCLUDED.has(slug) &&
      slug.length > 8 &&
      slug.includes('-') &&
      !slug.startsWith('wp-') &&
      !slug.startsWith('hentai-') &&
      !slug.startsWith('super-')
    ) {
      slugs.add(slug);
    }
  }

  // Detecta total de páginas via links de paginação
  const pageNums = [...html.matchAll(/\/page\/(\d+)\//g)].map(m => parseInt(m[1]));
  const totalPages = pageNums.length > 0 ? Math.max(...pageNums) : 1;

  return { slugs: [...slugs], totalPages };
}

async function fetchMhGalleryImage(mhId, imgNum) {
  try {
    const html = await fetchMhUrl(`${BASE_MH}/galeria?id=${mhId}&img=${imgNum}`);
    // Tenta vários padrões para URL da imagem real
    const patterns = [
      /<meta[^>]+property="og:image"\s+content="([^"]+)"/i,
      /<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i,
      /class="[^"]*(?:galeria|leitura|img-hentai|imagem-principal)[^"]*"[^>]*>[\s\S]{0,300}?<img[^>]+(?:data-src|src)="([^"]+)"/i,
      /<img[^>]+src="(https?:\/\/mundohentaioficial\.com\/wp-content\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i,
      /<img[^>]+src="(https?:\/\/[^"]*\/wp-content\/[^"]+\.(?:jpe?g|png|webp))"/i
    ];
    for (const p of patterns) {
      const mx = html.match(p);
      if (mx && mx[1] && !/logo|Logo|icon|banner|cropped/i.test(mx[1])) {
        return mx[1];
      }
    }
  } catch (e) {}
  return null;
}

async function fetchMhChapterPages(mhId, pageCount) {
  if (!mhId || !pageCount) return [];
  const indices = Array.from({ length: pageCount }, (_, i) => i + 1);
  const results = new Array(pageCount).fill(null);
  let nextIdx = 0;

  // 5 workers paralelos para as páginas da galeria
  await Promise.all(Array.from({ length: Math.min(5, pageCount) }, async () => {
    while (nextIdx < indices.length) {
      const idx = nextIdx++;
      try { results[idx] = await fetchMhGalleryImage(mhId, indices[idx]); } catch (e) {}
      await sleep(80);
    }
  }));

  return results.filter(Boolean);
}

async function runMhScrape(signal, mode) {
  const { data } = getMangaData();
  updateSubStep('pt', 'mundohentai', { status: 'running', processed: 0, total: 0 });
  broadcastState();

  // Corrige títulos de itens MH já importados (remove sufixo " - Mundo Hentai")
  let titleFixed = 0;
  for (const m of data) {
    if (m.source === 'mundohentai' && m.title) {
      const cleaned = m.title.replace(/\s*[-–|]\s*(Mundo\s*Hentai[^|<]*|MundoHentai[^|<]*)$/i, '').trim();
      if (cleaned !== m.title) { m.title = cleaned; titleFixed++; }
    }
  }
  if (titleFixed > 0) { scheduleSave(); log('pt', `  MundoHentai: ${titleFixed} títulos corrigidos.`); }

  const existingSlugs = new Set(data.filter(m => m.source === 'mundohentai').map(m => m.id));
  let newAdded = 0;
  const maxPages = mode === 'incremental' ? 3 : 9999;

  // --- Fase A: busca a página 1 para saber totalPages ---
  let totalPages = 1;
  try {
    const html1 = await fetchMhUrl(BASE_MH + '/');
    const { totalPages: detected } = parseMhListPage(html1);
    if (detected > 1) totalPages = Math.min(detected, maxPages);
    log('pt', `  MundoHentai: ${totalPages} páginas de listagem a varrer.`);
    updateSubStep('pt', 'mundohentai', { total: totalPages });

    // coleta slugs da página 1 imediatamente
    var { slugs: slugsP1 } = parseMhListPage(html1);
    var allSlugs = new Set(slugsP1);

    // --- Fase B: busca as demais páginas em paralelo (20 workers) ---
    if (totalPages > 1) {
      const pageQueue = [];
      for (let p = 2; p <= totalPages; p++) pageQueue.push(p);
      let nextPage = 0;
      const pageResults = new Array(pageQueue.length).fill(null);

      await Promise.all(Array.from({ length: Math.min(20, pageQueue.length) }, async () => {
        while (nextPage < pageQueue.length && !signal.aborted) {
          const qi = nextPage++;
          const pageNum = pageQueue[qi];
          const url = `${BASE_MH}/page/${pageNum}/`;
          try {
            const html = await fetchMhUrl(url);
            const { slugs } = parseMhListPage(html);
            pageResults[qi] = slugs;
            updateSubStep('pt', 'mundohentai', { processed: pageNum });
          } catch (e) {
            log('pt', `⚠️ MundoHentai: Erro pág. ${pageNum}: ${e.message}`, 'warn');
            pageResults[qi] = [];
          }
        }
      }));

      for (const slugList of pageResults) {
        if (slugList) slugList.forEach(s => allSlugs.add(s));
      }
    }
  } catch (e) {
    log('pt', `⚠️ MundoHentai: Falha ao listar catálogo: ${e.message}`, 'warn');
    updateSubStep('pt', 'mundohentai', { status: 'done', newAdded: 0 });
    return;
  }

  if (signal.aborted) return;

  // --- Fase C: processa apenas os slugs novos (5 workers) ---
  const newSlugs = [...allSlugs].filter(s => !existingSlugs.has(s));
  log('pt', `  MundoHentai: ${allSlugs.size} itens no catálogo, ${newSlugs.length} novos.`);
  updateSubStep('pt', 'mundohentai', { total: newSlugs.length, processed: 0 });

  let nextIdx = 0;
  await Promise.all(Array.from({ length: Math.min(5, newSlugs.length || 1) }, async () => {
    while (nextIdx < newSlugs.length && !signal.aborted) {
      const slug = newSlugs[nextIdx++];
      state.pt.current = [`MundoHentai: ${slug}`, '', '', ''];
      broadcastState();

      try {
        const postHtml = await fetchMhUrl(`${BASE_MH}/${slug}/`);
        const { mhId, pageCount, title, cover, description, tags, categories } = parseMhPost(postHtml);

        if (!mhId || !title) {
          log('pt', `⚠️ MundoHentai: Sem dados em ${slug}`, 'warn');
          continue;
        }

        // Usa categorias e tags diretamente do site, sem mapeamento/normalização
        const genres = [];
        for (const cat of categories) {
          if (cat && !genres.includes(cat)) genres.push(cat);
        }
        if (!genres.some(g => g.toLowerCase().includes('hentai'))) genres.unshift('Hentai');
        for (const tag of tags) {
          if (tag && !genres.includes(tag)) genres.push(tag);
        }

        const mangaEntry = {
          id: slug, slug, title, altTitle: '',
          cover: cover || `${BASE_MH}/galeria?id=${mhId}&img=1`,
          banner: cover || `${BASE_MH}/galeria?id=${mhId}&img=1`,
          author: 'Desconhecido', artist: 'Desconhecido',
          status: 'completed', year: new Date().getFullYear(), rating: 0,
          genres, description, descriptionPt: description,
          chaptersCount: 1, lang: 'pt', hasPt: true, hasEn: false,
          mhId, pageCount, source: 'mundohentai'
        };
        data.push(mangaEntry);
        existingSlugs.add(slug);

        saveChaptersFile(slug, {
          pt: [{
            id: `${slug}-chapter-1`,
            number: 1,
            title: 'Completo',
            date: new Date().toISOString(),
            pages: [],
            src: 'mundohentai',
            mhId,
            pageCount
          }]
        });

        log('pt', `  ✨ MundoHentai: +${title} (${pageCount} págs)`);
        newAdded++;
        updateSubStep('pt', 'mundohentai', { processed: newAdded, newAdded });
      } catch (e) {
        log('pt', `⚠️ MundoHentai: Erro em ${slug}: ${e.message}`, 'warn');
      }
      await sleep(150);
    }
  }));

  scheduleSave();
  if (!signal.aborted) {
    log('pt', `✅ MundoHentai: ${newAdded} novos itens adicionados.`, 'success');
    updateSubStep('pt', 'mundohentai', { status: 'done', newAdded });
    state.pt.current = [];
    broadcastState();
  }
}
async function runPtScrape(signal) {
  const s = state.pt;
  s.status = 'running'; s.startedAt = s.startedAt || new Date().toISOString();
  s.current = Array(WORKERS_PT).fill('');
  
  const lmStep = s.subSteps && s.subSteps.find(step => step.id === 'leituramanga');
  const lmDone = lmStep && lmStep.status === 'done';
  const lmStatus = lmDone ? 'done' : 'running';
  updateSubStep('pt', 'leituramanga', { status: lmStatus, processed: s.processed, total: s.total });
  
  const mlStep = s.subSteps && s.subSteps.find(step => step.id === 'mangalivre');
  const mlProcessed = mlStep ? mlStep.processed : 0;
  const mlTotal = mlStep ? mlStep.total : 0;
  const mlStatus = mlStep ? mlStep.status : 'idle';
  updateSubStep('pt', 'mangalivre', { status: mlStatus, processed: mlProcessed, total: mlTotal });

  const mhStep = s.subSteps && s.subSteps.find(step => step.id === 'mundohentai');
  const mhStatus = mhStep ? mhStep.status : 'idle';
  updateSubStep('pt', 'mundohentai', { status: mhStatus });

  broadcastState();
  const delay = s.speed === 'safe' ? DELAY_PT_SAFE : DELAY_PT_FAST;
  log('pt', `🚀 PT iniciado (${s.mode || 'incremental'}) — ${WORKERS_PT} workers, ${delay}ms/req (API)`);
  try {
    if (!lmDone) {
      // Catálogo da API (1 requisição) — sempre, pois os workers dependem dele.
      log('pt', '📡 Carregando catálogo da API (LeituraManga)...');
      await fetchPtCatalog();
      log('pt', `  Catálogo LeituraManga: ${_ptCatalog.length} mangás.`);

      // Feed global de capítulos (substitui 1 chamada por mangá → sem rate limit).
      // Completo: todos os capítulos num download. Incremental: janela recente.
      const feedLimit = (s.mode === 'incremental') ? PT_FEED_WINDOW : PT_LIMIT;
      log('pt', '📡 Carregando capítulos LeituraManga (feed global)...');
      const feed = await fetchPtChapterFeed(1, feedLimit);
      _ptFeedGrouped = groupPtFeed(feed);
      log('pt', `  LeituraManga: ${feed.length} capítulos • ${_ptFeedGrouped.size} mangás.`);

      if (s.queue.length === 0) {
        if (s.mode === 'incremental') {
          await collectPtLatestSlugs(signal, delay);
        } else {
          await collectPtSlugs(signal, delay);
        }
      }
      updateSubStep('pt', 'leituramanga', { total: s.total, processed: s.processed });
      if (signal.aborted) throw new Error('Aborted');
      log('pt', `📖 Fase 1 (LeituraManga): ${s.queue.length} mangás — ${WORKERS_PT} workers`);
      getMangaData(); // preload
      await Promise.all(Array.from({ length: WORKERS_PT }, (_, i) =>
        ptWorker(i, signal, delay).catch(e => { if (e.message !== 'Aborted') log('pt', `💥 W${i+1}: ${e.message}`, 'error'); })
      ));
      if (signal.aborted) throw new Error('Aborted');
      updateSubStep('pt', 'leituramanga', { status: 'done', processed: s.total });
    } else {
      log('pt', '⏭️ Fase 1 (LeituraManga) já concluída anteriormente. Pulando para Fase 2...');
    }

    // Fase 2: MangaLivre.blog
    log('pt', '🚀 Iniciando Fase 2: Varredura MangaLivre.blog...');
    await runMlScrapePart(signal, s.mode || 'incremental');
    if (signal.aborted) throw new Error('Aborted');

    // Fase 3: MundoHentai (+18)
    const mhStepNow = s.subSteps && s.subSteps.find(step => step.id === 'mundohentai');
    if (!mhStepNow || mhStepNow.status !== 'done') {
      log('pt', '🚀 Iniciando Fase 3: Varredura MundoHentai.com (+18)...');
      await runMhScrape(signal, s.mode || 'incremental');
      if (signal.aborted) throw new Error('Aborted');
    } else {
      log('pt', '⏭️ Fase 3 (MundoHentai) já concluída. Pulando...');
    }

    flushSave(); s.status = 'done'; s.current = [];
    log('pt', `🎉 PT concluído com sucesso nas três fontes!`, 'success');
  } catch(e) {
    flushSave();
    if (e.message === 'Aborted') {
      s.status = 'paused'; s.current = []; log('pt', `⏸️ Pausado.`, 'warn');
      if (state.pt.subSteps) {
        state.pt.subSteps.forEach(step => {
          if (step.status === 'running') step.status = 'paused';
        });
      }
    } else {
      s.status = 'error'; s.current = []; log('pt', `💥 Erro: ${e.message}`, 'error');
      if (state.pt.subSteps) {
        state.pt.subSteps.forEach(step => {
          if (step.status === 'running') step.status = 'error';
        });
      }
    }
  }
  saveState(); broadcastState();
}

// ══════════════════════════════════════════════════════════════════════════════
//  EN SCRAPER — igual ao mf-chapter-scraper.cjs + mf-meta-scraper.cjs
//  Base: ww2.mangafreak.me  |  Slug original: "One_Piece" (case+underscore)
//  Pages: [] vazio — imagens descobertas on-demand pelo discoverPages() do leitor
// ══════════════════════════════════════════════════════════════════════════════

function extractEnChapters(html, slug) {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tableRegex = new RegExp(
    `<tr>\\s*<td>\\s*<a\\s+href="/Read\\d+_${escaped}_([^"]+)"[^>]*>([\\s\\S]*?)</a>\\s*</td>\\s*<td>([^<]*)</td>`,
    'gi'
  );
  const chapters = [];
  const seen = new Set();
  let match;
  while ((match = tableRegex.exec(html)) !== null) {
    const num  = match[1];
    let title = match[2].replace(/<[^>]+>/g, '').trim();
    title = title.replace(/^Chapter\s+[\d.]+(?:[a-z])?\\s*[-:]?\\s*/i, '').trim();
    const date = match[3].trim();
    if (!seen.has(num)) { seen.add(num); chapters.push({ number: num, title: title, date: date }); }
  }
  return chapters;
}

function extractEnMeta(html) {
  const meta = { description: '', genres: [], author: '', artist: '', year: '', altTitle: '', status: '' };

  const descM = html.match(/class="manga_series_description"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  if (descM) meta.description = descM[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();

  meta.genres = [...new Set([...html.matchAll(/href="\/Genre\/([^"]+)"/g)].map(m => m[1]).filter(g => g !== 'All'))];

  const authM = html.match(/Written By:\s*([^<]+)<\/div>/i);
  if (authM) meta.author = authM[1].trim();

  const artM = html.match(/Illustrated By:\s*([^<]+)<\/div>/i);
  if (artM) meta.artist = artM[1].trim();

  const yearM = html.match(/Year Published:\s*(\d{4})/i);
  if (yearM) meta.year = yearM[1];

  const altM = html.match(/Alternative Title:\s*([^<]+)<\/div>/i);
  if (altM) meta.altTitle = altM[1].trim();

  const statM = html.match(/This is\s+([A-Z-]+)\s+series/i);
  if (statM) {
    const s = statM[1].toUpperCase();
    meta.status = (s === 'ON-GOING' || s === 'ONGOING') ? 'ongoing' : 'completed';
  }

  return meta;
}

async function collectEnLatestSlugs(signal, delay) {
  log('en', '📋 Buscando lançamentos recentes (EN)...');
  const slugSet = new Set();
  try {
    const html = await fetchUrl(BASE_EN);
    const mangaRegex = /\/Manga\/([A-Za-z0-9_]+)/g;
    const readRegex = /\/Read\d+_([A-Za-z0-9_]+)_\d+/g;
    let match;
    while ((match = mangaRegex.exec(html)) !== null) {
      slugSet.add(match[1]);
    }
    while ((match = readRegex.exec(html)) !== null) {
      slugSet.add(match[1]);
    }
    log('en', `  Encontrados ${slugSet.size} mangás recentemente atualizados no MangaFreak.`);
  } catch(e) {
    log('en', `  ❌ Erro ao buscar lançamentos recentes EN: ${e.message}`, 'error');
  }

  let mfList = [];
  if (fs.existsSync(MF_LIST_FILE)) {
    try { mfList = JSON.parse(fs.readFileSync(MF_LIST_FILE, 'utf8')); } catch(e) {}
  }
  
  const queueItems = [];
  for (const slug of slugSet) {
    let item = mfList.find(m => m.slug === slug || m.slug.toLowerCase() === slug.toLowerCase());
    if (!item) {
      const cleanId = slug.toLowerCase().replace(/_/g, '-');
      const cleanTitle = slug.replace(/_/g, ' ');
      item = {
        id: cleanId,
        slug: slug,
        title: cleanTitle,
        author: 'Desconhecido',
        status: 'ongoing',
        chapters: 0,
        cover: `https://images.mangafreak.me/manga_images/${slug.toLowerCase()}.jpg`,
        lang: 'en'
      };
      mfList.push(item);
    }
    queueItems.push(item);
  }
  
  try { fs.writeFileSync(MF_LIST_FILE, JSON.stringify(mfList, null, 2), 'utf8'); } catch(e) {}
  
  state.en.queue = queueItems;
  state.en.total = queueItems.length;
  saveState();
}

async function collectEnSlugs(signal, delay) {
  const filePath = MF_LIST_FILE;
  let existing = [];
  if (fs.existsSync(filePath)) {
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) {}
  }
  const doneSlugs = new Set(existing.map(m => m.slug));
  log('en', '📋 Fase 1: Mapeando catálogo completo EN (MangaFreak)...');
  let page = 1;
  const maxPages = 150;
  while (page <= maxPages) {
    if (signal.aborted) throw new Error('Aborted');
    try {
      const html = await fetchUrl(`${BASE_EN}/Genre/All/${page}`);
      const blocks = html.split('<div class="ranking_item">');
      let addedThisPage = 0;
      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const slugMatch = block.match(/href="[^"]*\/Manga\/([^"/]+)"/);
        if (!slugMatch) continue;
        const slug = slugMatch[1].replace(/\/$/, '');
        if (doneSlugs.has(slug)) continue;

        const titleMatch = block.match(/<h3 class="title">([^<]+)<\/h3>/);
        const title = titleMatch ? titleMatch[1].trim() : slug;

        const authorMatch = block.match(/Sensei Name - ([^<]+)</);
        const author = authorMatch ? authorMatch[1].trim() : '';

        const infoMatch = block.match(/(\d+) Published\.\s*\(([^)]+)\)/);
        const chapters = infoMatch ? parseInt(infoMatch[1]) : 0;
        const status = infoMatch ? (infoMatch[2].toLowerCase() === 'completed' ? 'completed' : 'ongoing') : 'ongoing';
        const cover = `https://images.mangafreak.me/manga_images/${slug.toLowerCase()}.jpg`;

        const item = {
          id: slug.toLowerCase().replace(/_/g, '-'),
          slug: slug,
          title: title,
          author: author,
          status: status,
          chapters: chapters,
          cover: cover,
          lang: 'en'
        };
        existing.push(item);
        doneSlugs.add(slug);
        addedThisPage++;
      }
      log('en', `  Pág ${page}: +${addedThisPage} (total: ${existing.length})`);
      if (addedThisPage === 0 && blocks.length <= 1) break;
      page++;
      if (page % 10 === 0) {
        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
      }
      await sleep(delay);
    } catch(e) {
      if (e.message === 'Aborted') throw e;
      if (e.message.startsWith('RATE_LIMIT')) {
        log('en', '  ⏳ Rate limit, aguardando...', 'warn');
        await sleep(5000);
        continue;
      }
      log('en', `  ❌ Pág ${page}: ${e.message}`, 'error');
      break;
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
  log('en', `✅ Mapeamento concluído! ${existing.length} mangás mapeados.`);
  return existing;
}

async function enWorker(workerId, queue, signal, delay) {
  const { data } = getMangaData();
  while (queue.length > 0 && !signal.aborted) {
    const item = queue.shift();
    if (!item) break;
    state.en.current[workerId] = item.slug;
    broadcastState();
    try {
      await sleep(delay + workerId * 40);
      const html = await fetchUrl(`${BASE_EN}/Manga/${item.slug}`);

      const chapters  = extractEnChapters(html, item.slug);
      const meta      = extractEnMeta(html);

      let manga = data.find(m => m.id === item.id || m.slug === item.slug);
      let mangaId = item.id;
      if (!manga) {
        manga = {
          id: item.id,
          slug: item.slug,
          title: item.title || item.slug,
          altTitle: meta.altTitle || '',
          cover: item.cover,
          banner: item.cover,
          author: meta.author || 'Desconhecido',
          artist: meta.artist || 'Desconhecido',
          status: meta.status || item.status || 'ongoing',
          year: meta.year ? parseInt(meta.year, 10) : new Date().getFullYear(),
          rating: 7.0,
          genres: meta.genres.length > 0 ? meta.genres.map(g => g.replace(/_/g, ' ')) : ['Manga'],
          description: meta.description || `Read ${item.title} online.`,
          chaptersCount: chapters.length,
          lang: 'en',
          hasPt: false,
          hasEn: true
        };
        data.push(manga);
        log('en', `✨ [W${workerId+1}] Novo: ${manga.title}`);
      } else {
        manga.hasEn = true;
        if (meta.description && meta.description.length > 0) manga.description = meta.description;
        if (meta.genres.length > 0) manga.genres = meta.genres.map(g => g.replace(/_/g, ' '));
        if (meta.author) manga.author = meta.author;
        if (meta.artist) manga.artist = meta.artist;
        if (meta.year) manga.year = parseInt(meta.year, 10);
        if (meta.altTitle && meta.altTitle !== manga.title) manga.altTitle = meta.altTitle;
        if (meta.status) manga.status = meta.status;
        manga.chaptersCount = Math.max(manga.chaptersCount || 0, chapters.length);
        mangaId = manga.id;
        log('en', `🔗 [W${workerId+1}] ${manga.title}`);
      }

      if (chapters.length > 0) {
        const chapObj = loadChaptersFile(mangaId);
        if (!chapObj.en) chapObj.en = [];
        const existing = new Set(chapObj.en.map(c => String(c.number)));
        const toAdd = chapters.filter(c => !existing.has(String(c.number)));
        if (toAdd.length > 0) {
          toAdd.forEach(ch => chapObj.en.push({
            id: `${mangaId}-${ch.number}`,
            number: parseFloat(ch.number) || ch.number,
            title: ch.title || '',
            date: ch.date,
            pages: []
          }));
          chapObj.en.sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
          saveChaptersFile(mangaId, chapObj);
        }
      }

      scheduleSave();
      saveState(); state.en.processed++;
    } catch(e) {
      if (e.message === 'Aborted') throw e;
      if (e.message.startsWith('RATE_LIMIT')) {
        log('en', `  ⏳ Rate limit, aguardando 5s...`, 'warn');
        queue.unshift(item); await sleep(5000);
      } else {
        log('en', `❌ [W${workerId+1}] ${item.slug}: ${e.message}`, 'error');
        state.en.errors++; state.en.processed++;
      }
    }
    state.en.current[workerId] = '';
  }
}

async function runEnScrape(signal) {
  const s = state.en;
  s.status = 'running'; s.startedAt = s.startedAt || new Date().toISOString();
  s.current = Array(WORKERS_EN).fill('');
  updateSubStep('en', 'mangafreak', { status: 'running' });
  broadcastState();
  const delay = s.speed === 'safe' ? DELAY_SAFE : DELAY_FAST;
  log('en', `🚀 EN iniciado (${s.mode || 'incremental'}) — ${WORKERS_EN} workers, ${delay}ms/req`);
  try {
    if (s.queue.length === 0) {
      if (s.mode === 'incremental') {
        await collectEnLatestSlugs(signal, delay);
      } else {
        if (!fs.existsSync(MF_LIST_FILE)) {
          await collectEnSlugs(signal, delay);
        }
        const mfList = JSON.parse(fs.readFileSync(MF_LIST_FILE, 'utf8'));
        s.queue = mfList;
        s.total = mfList.length;
        log('en', `📋 ${s.total} mangás EN na fila (de mf-manga-list.json)`);
        saveState();
      }
    }
    if (signal.aborted) throw new Error('Aborted');
    log('en', `📖 Atualizando ${s.queue.length} mangás EN — ${WORKERS_EN} workers`);
    getMangaData(); // preload cache
    const workQueue = [...s.queue];
    s.queue = [];
    await Promise.all(Array.from({ length: WORKERS_EN }, (_, i) =>
      enWorker(i, workQueue, signal, delay).catch(e => { if (e.message !== 'Aborted') log('en', `💥 W${i+1}: ${e.message}`, 'error'); })
    ));
    if (signal.aborted) throw new Error('Aborted');
    updateSubStep('en', 'mangafreak', { status: 'done', processed: s.total });
    if (signal.aborted) throw new Error('Aborted');

    // Fase 2: Hentai20.io (+18 EN)
    const h20Step = s.subSteps && s.subSteps.find(step => step.id === 'hentai20');
    if (!h20Step || h20Step.status !== 'done') {
      log('en', '🚀 Iniciando Fase 2: Varredura Hentai20.io (+18 EN)...');
      await runH20Scrape(signal, s.mode || 'incremental');
      if (signal.aborted) throw new Error('Aborted');
    } else {
      log('en', '⏭️ Fase 2 (Hentai20) já concluída. Pulando...');
    }

    flushSave(); s.status = 'done'; s.current = [];
    log('en', `🎉 EN concluído! ${s.processed} mangás atualizados.`, 'success');
  } catch(e) {
    flushSave();
    if (e.message === 'Aborted') {
      s.status = 'paused'; s.current = []; log('en', `⏸️ Pausado. ${s.processed}/${s.total}.`, 'warn');
      if (state.en.subSteps) state.en.subSteps.forEach(step => { if (step.status === 'running') step.status = 'paused'; });
    } else {
      s.status = 'error'; s.current = []; log('en', `💥 Erro: ${e.message}`, 'error');
      if (state.en.subSteps) state.en.subSteps.forEach(step => { if (step.status === 'running') step.status = 'error'; });
    }
  }
  saveState(); broadcastState();
}

// ── AGENDADOR AUTOMÁTICO (Scheduler) ───────────────────────────────────────────

function calculateNextRun() {
  const sched = state.scheduler;
  if (!sched || !sched.enabled) {
    sched.nextRun = null;
    return;
  }

  const now = new Date();
  let baseDate = sched.lastRun ? new Date(sched.lastRun) : now;
  
  if (now - baseDate > 30 * 24 * 60 * 60 * 1000) {
    baseDate = now;
  }

  let next = new Date(baseDate);

  if (sched.interval === '1h') {
    next.setHours(next.getHours() + 1);
  } else if (sched.interval === '6h') {
    next.setHours(next.getHours() + 6);
  } else if (sched.interval === '12h') {
    next.setHours(next.getHours() + 12);
  } else if (sched.interval === '1d') {
    next.setDate(next.getDate() + 1);
  } else if (sched.interval === '3am') {
    next = new Date();
    next.setHours(3, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else {
    next.setHours(next.getHours() + 12);
  }

  while (next <= now) {
    if (sched.interval === '1h') next.setHours(next.getHours() + 1);
    else if (sched.interval === '6h') next.setHours(next.getHours() + 6);
    else if (sched.interval === '12h') next.setHours(next.getHours() + 12);
    else if (sched.interval === '1d') next.setDate(next.getDate() + 1);
    else if (sched.interval === '3am') next.setDate(next.getDate() + 1);
    else next.setHours(next.getHours() + 12);
  }

  sched.nextRun = next.toISOString();
}

function runScheduledUpdate() {
  const sched = state.scheduler;
  if (!sched || !sched.enabled) return;

  if (state.pt.status === 'running' || state.en.status === 'running') {
    log('scheduler', '⚠️ Atualização agendada adiada por 15min: outro processo de atualização está ativo.', 'warn');
    const delayNext = new Date();
    delayNext.setMinutes(delayNext.getMinutes() + 15);
    sched.nextRun = delayNext.toISOString();
    saveState();
    broadcastState();
    return;
  }

  log('scheduler', `⏰ Iniciando atualização agendada (Frequência: ${sched.interval} | Modo: ${sched.mode})...`, 'info');
  
  sched.lastRun = new Date().toISOString();
  calculateNextRun();
  saveState();
  broadcastState();

  const speed = 'fast';
  const mode = sched.mode;

  if (sched.lang === 'pt' || sched.lang === 'both') {
    state.pt = { status:'idle', processed:0, total:0, current:[], errors:0, startedAt:null, queue:[], speed, mode };
    const ptCtrl = { aborted: false };
    controllers['pt'] = ptCtrl;
    runPtScrape(ptCtrl);
  }

  if (sched.lang === 'en' || sched.lang === 'both') {
    state.en = { status:'idle', processed:0, total:0, current:[], errors:0, startedAt:null, queue:[], speed, mode };
    const enCtrl = { aborted: false };
    controllers['en'] = enCtrl;
    runEnScrape(enCtrl);
  }
}

function checkScheduler() {
  const sched = state.scheduler;
  if (!sched || !sched.enabled) return;

  const now = new Date();
  if (!sched.nextRun) {
    calculateNextRun();
    saveState();
    broadcastState();
    return;
  }

  const nextRunDate = new Date(sched.nextRun);
  if (now >= nextRunDate) {
    runScheduledUpdate();
  }
}

function startSchedulerTimer() {
  setInterval(checkScheduler, 60000);
  setTimeout(checkScheduler, 5000);
}

// ══════════════════════════════════════════════════════════════════════════════
//  HTTP Server
// ══════════════════════════════════════════════════════════════════════════════
http.createServer((req, res) => {
  const _parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = _parsedUrl.pathname;
  const _urlSearchParams = _parsedUrl.searchParams;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

  // SSE — eventos em tempo real
  if (pathname === '/events') {
    res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
    const init = JSON.stringify({ type:'state', state:{ pt:omitQueue(state.pt), en:omitQueue(state.en) }, log:state.log });
    res.write(`data: ${init}\n\n`);
    clients.push(res);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
    return;
  }

  // Resolução de capítulos sob demanda (PT e EN)
  if (pathname === '/resolve-chapter' && req.method === 'GET') {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const mangaId = urlObj.searchParams.get('mangaId');
    const slug = urlObj.searchParams.get('slug');
    const chNum = urlObj.searchParams.get('chNum');
    const lang = (urlObj.searchParams.get('lang') || 'pt').toLowerCase() === 'en' ? 'en' : 'pt';

    if (!mangaId || !slug || !chNum) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Missing parameters' }));
    }

    log(lang, `🔍 Resolvendo páginas (${lang.toUpperCase()}): ${mangaId} cap ${chNum}`);
    let resolver;
    if (lang === 'en') {
      resolver = fetchEnChapterPages(slug, chNum);
    } else {
      const chapObj = loadChaptersFile(mangaId);
      const ch = chapObj.pt && chapObj.pt.find(c => String(c.number) === String(chNum));
      if (ch && ch.src === 'mangalivre' && ch.mlId) {
        resolver = fetchMlChapterPages(ch.mlId);
      } else if (ch && ch.src === 'mundohentai' && ch.mhId) {
        resolver = fetchMhChapterPages(ch.mhId, ch.pageCount || 0);
      } else {
        resolver = fetchPtChapterPages(slug, chNum);
      }
    }
    resolver
      .then(pages => {
        if (pages && pages.length > 0) {
          const chapObj = loadChaptersFile(mangaId);
          if (!chapObj[lang]) chapObj[lang] = [];
          const ch = chapObj[lang].find(c => String(c.number) === String(chNum));
          if (ch) {
            ch.pages = pages;
            saveChaptersFile(mangaId, chapObj);
            log(lang, `✅ Resolvido e salvo: ${mangaId} cap ${chNum} (${pages.length} páginas)`);
          } else {
            chapObj[lang].push({
              id: `${mangaId}-chapter-${chNum}`,
              number: parseFloat(chNum),
              title: `Capítulo ${chNum}`,
              date: new Date().toISOString(),
              pages: pages
            });
            chapObj[lang].sort((a, b) => a.number - b.number);
            saveChaptersFile(mangaId, chapObj);
            log(lang, `✅ Criado e salvo: ${mangaId} cap ${chNum} (${pages.length} páginas)`);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, pages }));
        } else {
          log(lang, `⚠️ Nenhuma página encontrada para ${mangaId} cap ${chNum}`, 'warn');
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No pages found' }));
        }
      })
      .catch(err => {
        log(lang, `❌ Erro resolvendo páginas para ${mangaId} cap ${chNum}: ${err.message}`, 'error');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    return;
  }

  // Estado atual
  if (pathname === '/state') {
    res.writeHead(200, { 'Content-Type':'application/json' });
    return res.end(JSON.stringify({ pt:omitQueue(state.pt), en:omitQueue(state.en), scheduler:state.scheduler, transition_delay:state.transition_delay, log:state.log }));
  }

  // Controle
  if (pathname === '/control' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { action, lang, speed, mode } = JSON.parse(body || '{}');
      const s = state[lang];
      if (!s && action !== 'clear-log') { res.writeHead(400); return res.end('Invalid lang'); }

      if (action === 'start' || action === 'resume') {
        if (s.status === 'running') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ok:false})); }
        if (action === 'start' && s.status !== 'paused') {
          state[lang] = { status:'idle', processed:0, total:0, current:[], errors:0, startedAt:null, queue:[], speed: speed||'fast', mode: mode||'incremental' };
        } else {
          if (speed) s.speed = speed;
          if (mode) s.mode = mode;
        }
        const signal = { aborted: false };
        controllers[lang] = signal;
        _cache = null;
        if (lang === 'pt') runPtScrape(signal);
        else runEnScrape(signal);

      } else if (action === 'set-speed') {
        if (state[lang]) { state[lang].speed = speed || 'fast'; broadcastState(); }

      } else if (action === 'set-mode') {
        if (state[lang]) { state[lang].mode = mode || 'incremental'; broadcastState(); }

      } else if (action === 'pause') {
        if (controllers[lang]) controllers[lang].aborted = true;

      } else if (action === 'reset') {
        if (controllers[lang]) controllers[lang].aborted = true;
        setTimeout(() => {
          state[lang] = { status:'idle', processed:0, total:0, current:[], errors:0, startedAt:null, queue:[], speed:'fast', mode:'incremental' };
          saveState(); broadcastState();
        }, 600);

      } else if (action === 'clear-log') {
        state.log = []; broadcastState();
      }

      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true}));
    });
    return;
  }

  // GET /search-manga?q=...
  if (pathname === '/search-manga' && req.method === 'GET') {
    const q = _urlSearchParams.get('q') || '';
    const { data } = getMangaData();
    const lower = q.toLowerCase().trim();
    let results;
    if (!lower) {
      // return all hidden manga when no query
      results = data.filter(m => m.hidden).slice(0, 100);
    } else {
      results = data.filter(m => (m.title || '').toLowerCase().includes(lower)).slice(0, 50);
    }
    const out = results.map(m => ({ id: m.id, slug: m.slug, title: m.title, cover: m.cover, hidden: !!m.hidden, source: m.source || '' }));
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(out));
  }

  // POST /toggle-hidden  { id, hidden }
  if (pathname === '/toggle-hidden' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { id, hidden } = JSON.parse(body);
        const { data } = getMangaData();
        const m = data.find(x => x.id === id || x.slug === id);
        if (!m) { res.writeHead(404); return res.end(JSON.stringify({ ok: false, error: 'not found' })); }
        if (hidden) m.hidden = true; else delete m.hidden;
        scheduleSave();
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true, id: m.id, hidden: !!m.hidden }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /scheduler-config  { enabled, interval, lang, mode }
  if (pathname === '/scheduler-config' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { enabled, interval, lang, mode } = JSON.parse(body || '{}');
        
        state.scheduler.enabled = !!enabled;
        state.scheduler.interval = interval || '12h';
        state.scheduler.lang = lang || 'pt';
        state.scheduler.mode = mode || 'incremental';
        
        calculateNextRun();
        saveState();
        broadcastState();
        
        log('scheduler', `⚙️ Agendador atualizado: ${state.scheduler.enabled ? 'ATIVADO' : 'DESATIVADO'} (${state.scheduler.interval}, ${state.scheduler.lang}, ${state.scheduler.mode})`, 'info');
        
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true, scheduler: state.scheduler }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /settings
  if (pathname === '/settings' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type':'application/json' });
    return res.end(JSON.stringify({ transition_delay: state.transition_delay || 10 }));
  }

  // POST /settings
  if (pathname === '/settings' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { transition_delay } = JSON.parse(body || '{}');
        const delay = parseInt(transition_delay, 10);
        state.transition_delay = isNaN(delay) ? 10 : delay;
        saveState();
        broadcastState();
        log('system', `⚙️ Delay de transição atualizado para: ${state.transition_delay}s`, 'info');
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true, transition_delay: state.transition_delay }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /img-proxy?url=... — proxeia imagens do mangafreak (bloqueiam hotlink)
  if (pathname === '/img-proxy' && req.method === 'GET') {
    const target = _urlSearchParams.get('url') || '';
    if (!target || !target.startsWith('https://images.mangafreak.me/')) {
      res.writeHead(400); return res.end('url inválida');
    }
    fetchBinary(target, { 'Referer': 'https://ww2.mangafreak.me/' })
      .then(({ buf, contentType, status }) => {
        if (status !== 200) { res.writeHead(status); return res.end('upstream ' + status); }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=604800',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(buf);
      })
      .catch(e => { res.writeHead(502); res.end('proxy error: ' + e.message); });
    return;
  }

  res.writeHead(404); res.end('Not found');
}).listen(PORT, async () => {
  console.log(`\n🚀 Admin server → http://localhost:${PORT}`);
  console.log(`   Painel     → http://localhost:3000/admin.html`);
  console.log(`\n   PT: api.leituramanga.net (API JSON) | ${WORKERS_PT} workers | catálogo em 1 requisição`);
  console.log(`   EN: ww2.mangafreak.me (HTML) | 5 workers | delay configurável`);
  console.log(`   MH: mundohentaioficial.com (HTML) | conteúdo +18`);
  console.log(`   EN pages: [] vazio — imagens via CDN pattern em tempo de leitura\n`);

  // Inicializa o temporizador do agendador automático
  startSchedulerTimer();

  // Startup: resolve placeholder covers buscando no MangaFreak pelo slug
  (async () => {
    try {
      const { data } = getMangaData();
      const PLACEHOLDER = 'placeholder.jpg';
      const toFix = data.filter(m => m.cover && m.cover.includes(PLACEHOLDER));
      if (!toFix.length) return;
      console.log(`[ADMIN] 🖼️  Resolvendo ${toFix.length} capa(s) com placeholder...`);
      let fixed = 0;
      for (const m of toFix) {
        // Tenta padrão MangaFreak: slug → underscore
        const mfkSlug = (m.id || m.slug || '').replace(/-/g, '_');
        const mfkUrl = `https://images.mangafreak.me/manga_images/${mfkSlug}.jpg`;
        try {
          const { status } = await fetchBinary(mfkUrl, { 'Referer': 'https://ww2.mangafreak.me/' });
          if (status === 200) {
            m.cover = mfkUrl;
            if (m.banner && m.banner.includes(PLACEHOLDER)) m.banner = mfkUrl;
            fixed++;
            console.log(`[ADMIN]   ✅ Capa encontrada: ${m.title}`);
          }
        } catch(_) {}
      }
      if (fixed > 0) {
        scheduleSave();
        console.log(`[ADMIN] 🖼️  ${fixed} capa(s) resolvida(s).`);
      } else {
        console.log('[ADMIN] 🖼️  Nenhuma capa placeholder resolvida (slugs não encontrados no MangaFreak).');
      }
    } catch(e) { console.log('[ADMIN] ⚠️ Erro ao resolver placeholders:', e.message); }
  })();
});
