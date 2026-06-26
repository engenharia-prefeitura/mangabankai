const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://leituramanga.net';
const API_BASE = 'https://api.leituramanga.net';
const CDN_BASE = 'https://cdn.leituramanga.net/';
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, 'js', 'chapters');
const BIG_LIMIT = '9007199254740991';
const MAX_RETRIES = 3;
// Concorrência usada só para buscar descrição (HTML) de mangás novos.
const CONCURRENCY = parseInt(process.env.SCRAPER_CONCURRENCY || '4', 10);
// Tamanho de página do feed no modo incremental.
const FEED_PAGE = parseInt(process.env.SCRAPER_FEED_PAGE || '500', 10);

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY + 2 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY + 2 });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ---------- HTTP (gzip + keep-alive + retry + cooldown global) ----------
let _cooldownUntil = 0;

function rawFetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;
    const req = client.get(url, {
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://leituramanga.net/'
      },
      timeout: 60000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        res.resume();
        return rawFetch(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        const err = new Error(`HTTP ${res.statusCode} for ${url}`);
        err.statusCode = res.statusCode;
        return reject(err);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch (e) {}
        resolve(buf.toString('utf8'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`Timeout for ${url}`)); });
  });
}

async function fetch(url) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const wait = _cooldownUntil - Date.now();
    if (wait > 0) await delay(wait + Math.floor(Math.random() * 250));
    try {
      return await rawFetch(url);
    } catch (e) {
      lastErr = e;
      const retriable = !e.statusCode || e.statusCode === 429 || e.statusCode === 503 || e.statusCode >= 500;
      if (attempt === MAX_RETRIES || !retriable) break;
      const backoff = 1000 * Math.pow(1.8, attempt) + Math.floor(Math.random() * 400);
      if (e.statusCode === 429 || e.statusCode === 503) _cooldownUntil = Date.now() + backoff;
      await delay(backoff);
    }
  }
  throw lastErr;
}

async function fetchJson(url) { return JSON.parse(await fetch(url)); }

async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      try { await worker(items[idx], idx); } catch (e) { console.error(`   ⚠️ ${e.message}`); }
    }
  });
  await Promise.all(runners);
}

// ---------- API ----------
async function fetchCatalog() {
  const json = await fetchJson(`${API_BASE}/api/manga?page=1&limit=${BIG_LIMIT}`);
  if (!json || !json.success || !json.data || !Array.isArray(json.data.data)) throw new Error('Resposta inesperada do catálogo');
  return json.data.data;
}

// Feed global de capítulos (todos os mangás). Ordenado por releaseDate desc.
async function fetchChapterFeed(page, limit) {
  const json = await fetchJson(`${API_BASE}/api/chapter/latest?page=${page}&limit=${limit}`);
  if (json && json.success && json.data && Array.isArray(json.data.chapters)) return json.data.chapters;
  return [];
}

// Agrupa o feed por slug do mangá → Map slug -> [{number,title,date}]
function groupFeedBySlug(feed) {
  const map = new Map();
  for (const ch of feed) {
    const slug = ch.manga && ch.manga.slug;
    if (!slug) continue;
    if (!map.has(slug)) map.set(slug, []);
    map.get(slug).push({ number: ch.chapterNumber, title: ch.title, date: ch.releaseDate });
  }
  return map;
}

function buildCover(slug) { return `${CDN_BASE}${slug}/cover-md.webp`; }
function mapGenres(item) {
  if (Array.isArray(item.genres) && item.genres.length) return item.genres.map(g => (g && g.name) ? g.name : g).filter(Boolean);
  return ['Manga'];
}
function mapAuthor(item) {
  if (Array.isArray(item.authors) && item.authors.length && item.authors[0].name) return item.authors[0].name.trim();
  return 'Desconhecido';
}

// ---------- Descrição (HTML) — só para mangá novo ----------
function extractRscPayload(html) {
  const matches = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) || [];
  return matches.map(m => {
    const c = m.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/);
    return c ? c[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t') : '';
  }).join('');
}
async function fetchDescription(slug, title) {
  try {
    const html = await fetch(`${BASE_URL}/manga/${slug}`);
    const rsc = extractRscPayload(html);
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) || rsc.match(/"description"\s*:\s*"([^"]+)"/);
    const raw = descMatch ? descMatch[1].trim() : `Leia ${title} online em português.`;
    return raw
      .replace(/,?\s*online\s+gr[aá]tis\s+no\s+Leitura\s+Manga\.?/gi, '.')
      .replace(/\s*Acompanhe\s+cap[ií]tulos\s+atualizados\s+com\s+imagens\s+em\s+alta\s+qualidade\.?/gi, '')
      .replace(/\s*no\s+Leitura\s+Manga\.?/gi, '.')
      .replace(/\s*Leitura\s+Manga\.?/gi, '.')
      .replace(/\.{2,}/g, '.')
      .trim();
  } catch (e) { return `Leia ${title} online em português.`; }
}

// ---------- data.js ----------
function normalizeTitle(title) {
  return (title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').trim();
}
function findMangaBySlug(slug, mangaList) {
  const normSlug = slug.toLowerCase().replace(/_/g, '-');
  return mangaList.find(m => m.slug === slug || m.id === normSlug || normalizeTitle(m.slug) === normalizeTitle(slug)) || null;
}
function findMangaMatch(title, slug, mangaList) {
  const bySlug = findMangaBySlug(slug, mangaList);
  if (bySlug) return bySlug;
  const nt = normalizeTitle(title);
  return mangaList.find(m => normalizeTitle(m.title) === nt || (m.altTitle && normalizeTitle(m.altTitle) === nt)) || null;
}
// Localiza os limites do array MANGA_DATA (robusto a `let` ou `const`).
function mangaDataBounds(content) {
  const marker = content.indexOf('MANGA_DATA = [');
  if (marker < 0) throw new Error('MANGA_DATA não encontrado em data.js');
  const startIdx = content.indexOf('[', marker);
  // Parser string-aware: ignora [ e ] dentro de strings JSON (ex: título "Chii-chan ]")
  let depth = 0, inStr = false, esc = false, endIdx = startIdx;
  for (let i = startIdx; i < content.length; i++) {
    const c = content[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
    }
  }
  return { startIdx, endIdx };
}
function loadMangaList() {
  if (!fs.existsSync(DATA_JS_PATH)) { console.error(`File not found: ${DATA_JS_PATH}`); return []; }
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = mangaDataBounds(content);
  return JSON.parse(content.substring(startIdx, endIdx));
}
function saveMangaList(mangaList) {
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = mangaDataBounds(content);
  fs.writeFileSync(DATA_JS_PATH, content.substring(0, startIdx) + JSON.stringify(mangaList, null, 2) + content.substring(endIdx), 'utf8');
  try { require('./build-lite.cjs').buildLite(); } catch (e) {}
  try { require('./build-home.cjs').buildHome(); } catch (e) {}
}
function loadChapters(mangaId) {
  const chFilePath = path.join(CHAPTERS_DIR, `${mangaId}.json`);
  let obj = {};
  if (fs.existsSync(chFilePath)) { try { obj = JSON.parse(fs.readFileSync(chFilePath, 'utf8')); } catch (e) {} }
  if (!obj.pt) obj.pt = [];
  return { chFilePath, obj };
}
// Mescla entradas {number,title,date} e grava. Retorna quantos foram adicionados.
function mergeChapters(mangaId, chObj, chFilePath, entries) {
  const existing = new Set(chObj.pt.map(c => String(c.number)));
  let added = 0;
  for (const e of entries) {
    const num = String(e.number);
    if (existing.has(num)) continue;
    chObj.pt.push({
      id: `${mangaId}-chapter-${e.number}`,
      number: parseFloat(e.number),
      title: e.title || `Capítulo ${e.number}`,
      date: e.date || new Date().toISOString(),
      pages: []
    });
    existing.add(num);
    added++;
  }
  if (added > 0) {
    chObj.pt.sort((a, b) => a.number - b.number);
    fs.writeFileSync(chFilePath, JSON.stringify(chObj, null, 2), 'utf8');
  }
  return added;
}
function buildNewManga(slug, title, description, item) {
  const author = item ? mapAuthor(item) : 'Desconhecido';
  return {
    id: slug, slug, title: title, altTitle: '', cover: buildCover(slug), banner: buildCover(slug),
    author, artist: author, status: (item && item.status === 2) ? 'completed' : 'ongoing',
    year: (item && item.releaseYear) || new Date().getFullYear(), rating: 7.0,
    genres: item ? mapGenres(item) : ['Manga'], description, descriptionPt: description,
    chaptersCount: 0, lang: 'pt', hasPt: true, hasEn: false
  };
}

// ---------- Modos ----------

// COMPLETO: 2 requisições (catálogo + feed global). Zero chamadas por mangá.
async function runFullCatalogUpdate() {
  console.log('📦 Varredura COMPLETA (feed global)...');
  const mangaList = loadMangaList();
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });

  console.log('📡 (1/2) Catálogo...');
  const catalog = await fetchCatalog();
  console.log(`   ${catalog.length} mangás.`);
  console.log('📡 (2/2) Todos os capítulos (download único)...');
  const feed = await fetchChapterFeed(1, BIG_LIMIT);
  const grouped = groupFeedBySlug(feed);
  console.log(`   ${feed.length} capítulos, ${grouped.size} mangás com capítulos.`);

  let newMangas = 0, newChapters = 0;
  // Só há rede aqui para descrição de mangá novo → pool pequeno.
  await runPool(catalog, CONCURRENCY, async (item) => {
    const slug = item.slug;
    if (!slug) return;
    let m = findMangaMatch(item.title, slug, mangaList);
    if (!m) {
      const description = await fetchDescription(slug, item.title);
      m = buildNewManga(slug, item.title, description, item);
      mangaList.push(m);
      newMangas++;
    } else {
      m.hasPt = true;
      if (!m.author || m.author === 'Desconhecido') { const a = mapAuthor(item); if (a !== 'Desconhecido') { m.author = a; m.artist = a; } }
      if (!m.genres || !m.genres.length || m.genres[0] === 'Manga') m.genres = mapGenres(item);
    }
    const entries = grouped.get(slug) || [];
    const { chFilePath, obj } = loadChapters(m.id);
    const added = mergeChapters(m.id, obj, chFilePath, entries);
    newChapters += added;
    m.chaptersCount = Math.max(m.chaptersCount || 0, obj.pt.length);
  });

  saveMangaList(mangaList);
  console.log(`\n🎉 Completa concluída! ${newMangas} mangás novos, ${newChapters} capítulos adicionados.`);
}

// INCREMENTAL: pagina o feed (mais recente primeiro) e para quando uma página
// inteira não traz nada novo. Normalmente 1 página resolve.
async function runIncrementalUpdate() {
  console.log('🔄 Varredura Incremental (feed global)...');
  const mangaList = loadMangaList();
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });

  console.log('📡 Catálogo (para metadados de mangás novos)...');
  const catalog = await fetchCatalog();
  const catBySlug = new Map();
  for (const it of catalog) { if (it.slug) catBySlug.set(it.slug, it); }

  const chCache = new Map(); // mangaId -> { chFilePath, obj }
  let page = 1, addedThisPage = 0, totalNew = 0, newMangas = 0;

  do {
    const feed = await fetchChapterFeed(page, FEED_PAGE);
    if (feed.length === 0) break;
    const grouped = groupFeedBySlug(feed);
    addedThisPage = 0;

    for (const [slug, entries] of grouped) {
      let m = findMangaBySlug(slug, mangaList);
      if (!m) {
        const item = catBySlug.get(slug);
        const title = item ? item.title : (entries[0] && entries[0].mangaTitle) || slug;
        const description = item ? await fetchDescription(slug, title) : `Leia ${title} online em português.`;
        m = buildNewManga(slug, title, description, item);
        mangaList.push(m);
        newMangas++;
        console.log(`✨ Novo: ${title}`);
      } else {
        m.hasPt = true;
      }
      let cache = chCache.get(m.id);
      if (!cache) { cache = loadChapters(m.id); chCache.set(m.id, cache); }
      const added = mergeChapters(m.id, cache.obj, cache.chFilePath, entries);
      if (added > 0) {
        addedThisPage += added;
        totalNew += added;
        m.chaptersCount = Math.max(m.chaptersCount || 0, cache.obj.pt.length);
        console.log(`   📥 ${m.title}: +${added}`);
      }
    }
    page++;
  } while (addedThisPage > 0 && page <= 100);

  saveMangaList(mangaList);
  console.log(`\n🎉 Incremental concluída! ${newMangas} mangás novos, ${totalNew} capítulos novos.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--all')) await runFullCatalogUpdate();
  else await runIncrementalUpdate();
}

main().catch(console.error);
