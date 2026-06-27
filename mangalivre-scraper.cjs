const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://mangalivre.blog';
const API_BASE = 'https://mangalivre.blog/wp-json/wp/v2';
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, 'js', 'chapters');
const MAX_RETRIES = 3;
const CONCURRENCY = parseInt(process.env.SCRAPER_CONCURRENCY || '4', 10);
const FEED_PAGE = 100; // per_page parameter for WP REST API

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 25 });

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ---------- HTTP (gzip + keep-alive + retry) ----------
function rawFetch(url, redirects = 0, withHeaders = false) {
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
        'Referer': 'https://mangalivre.blog/'
      },
      timeout: 30000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        res.resume();
        return rawFetch(next, redirects + 1, withHeaders).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        const err = new Error(`HTTP ${res.statusCode} for ${url}`);
        err.statusCode = res.statusCode;
        return reject(err);
      }
      const responseHeaders = res.headers;
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (responseHeaders['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch (e) {}
        const body = buf.toString('utf8');
        resolve(withHeaders ? { body, headers: responseHeaders } : body);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`Timeout for ${url}`)); });
  });
}

async function fetch(url) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await rawFetch(url);
    } catch (e) {
      lastErr = e;
      const retriable = !e.statusCode || e.statusCode === 429 || e.statusCode === 503 || e.statusCode >= 500;
      if (attempt === MAX_RETRIES || !retriable) break;
      const backoff = 1000 * Math.pow(1.8, attempt) + Math.floor(Math.random() * 400);
      await delay(backoff);
    }
  }
  throw lastErr;
}

async function fetchWithHeaders(url) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await rawFetch(url, 0, true); // retorna { body, headers }
    } catch (e) {
      lastErr = e;
      const retriable = !e.statusCode || e.statusCode === 429 || e.statusCode === 503 || e.statusCode >= 500;
      if (attempt === MAX_RETRIES || !retriable) break;
      const backoff = 1000 * Math.pow(1.8, attempt) + Math.floor(Math.random() * 400);
      await delay(backoff);
    }
  }
  throw lastErr;
}

async function fetchJson(url) { return JSON.parse(await fetch(url)); }
async function fetchJsonWithHeaders(url) {
  const { body, headers } = await fetchWithHeaders(url);
  return { data: JSON.parse(body), headers };
}

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

// ---------- Title/Entity Parsing helpers ----------
function decodeEntities(str) {
  return (str || '')
    .replace(/&#8211;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseChapterTitle(renderedTitle, slug) {
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

  // Extract number from chapterPart or titleDecoded
  const numMatch = chapterPart.match(/(?:Capítulo|Cap)\s*([\d.]+)/i) || titleDecoded.match(/(?:Capítulo|Cap)\s*([\d.]+)/i);
  const chapterNumber = numMatch ? parseFloat(numMatch[1]) : null;

  // Extract mangaSlug from chapter slug (e.g. one-punch-man-capitulo-233)
  let mangaSlug = '';
  const capituloIdx = slug.indexOf('-capitulo-');
  if (capituloIdx > 0) {
    mangaSlug = slug.substring(0, capituloIdx);
  } else {
    mangaSlug = mangaTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  return { mangaTitle, mangaSlug, chapterNumber };
}

// ---------- Manga Details (HTML Scraper) ----------
async function fetchMangaDetails(slug, defaultTitle) {
  try {
    const url = `${BASE_URL}/manga/${slug}/`;
    const html = await fetch(url);
    
    // Title
    const titleMatch = html.match(/<h1 class="manga-title">([\s\S]*?)<\/h1>/i);
    let title = defaultTitle;
    if (titleMatch) {
      // Strip language flag div if present
      title = titleMatch[1].replace(/<div class="manga-language-flag"[\s\S]*?<\/div>/i, '').replace(/<[^>]+>/g, '').trim();
    }
    
    // Description/Synopsis
    const descMatch = html.match(/<div class="synopsis-content">([\s\S]*?)<\/div>/i);
    let description = `Leia ${title} online em português no MangaLivre.`;
    if (descMatch) {
      description = descMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }
    
    // Cover — tenta múltiplas fontes na ordem de preferência
    let cover = '';

    function isBadCover(url) {
      return !url || url.includes('/wp-content/themes/') ||
        url.includes('placeholder') || url.includes('no-image') ||
        url.includes('noimage') || url.includes('cropped-cropped');
    }

    // 1. div.manga-cover img
    const coverDivMatch = html.match(/<div class="manga-cover">[\s\S]*?<img[^>]+src="([^"]+)"/i);
    if (coverDivMatch && !isBadCover(coverDivMatch[1])) {
      cover = coverDivMatch[1];
    }

    // 2. og:image
    if (!cover) {
      const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/i) ||
                      html.match(/name="og:image"\s+content="([^"]+)"/i);
      if (ogMatch && !isBadCover(ogMatch[1]) && ogMatch[1].includes('mangalivre.blog')) {
        cover = ogMatch[1];
      }
    }

    // 3. Qualquer img de upload com dimensões típicas de capa
    if (!cover) {
      const sizePatterns = ['350x500', '211x300', '300x400', '225x315'];
      for (const size of sizePatterns) {
        const sizeMatch = html.match(new RegExp(`(https://mangalivre\\.blog/wp-content/uploads/[^\\s"'<>]*${size}[^\\s"'<>]*)`, 'i'));
        if (sizeMatch) { cover = sizeMatch[1]; break; }
      }
    }
    
    // Genres
    const genres = [];
    const genreRegex = /<span class="manga-tag">([^<]+)<\/span>/gi;
    let gMatch;
    while ((gMatch = genreRegex.exec(html)) !== null) {
      const g = gMatch[1].trim();
      if (g && !genres.includes(g)) genres.push(g);
    }
    
    // Meta fields (Autor, Artista, Ano, Status)
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
    console.error(`   ⚠️ Erro ao raspar detalhes de ${slug}: ${e.message}`);
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

// ---------- data.js / JSON files helpers ----------
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

// Mescla os capítulos na chave pt com regras de prioridade/conflitos
function mergeChapters(mangaId, chObj, chFilePath, entries) {
  let added = 0;
  let updated = 0;
  
  for (const e of entries) {
    const num = parseFloat(e.number);
    if (isNaN(num)) continue;
    
    const existingIdx = chObj.pt.findIndex(c => String(c.number) === String(num));
    
    if (existingIdx < 0) {
      // Novo capítulo
      chObj.pt.push({
        id: `${mangaId}-chapter-${e.number}`,
        number: num,
        title: e.title || `Capítulo ${e.number}`,
        date: e.date || new Date().toISOString(),
        pages: [],
        src: 'mangalivre',
        mlId: e.mlId
      });
      added++;
    } else {
      // Conflito: capítulo já existe.
      // Compara data. Se o incoming for mais recente ou a fonte atual for diferente,
      // prioriza a fonte que estiver com informações de data atualizadas
      const existingCh = chObj.pt[existingIdx];
      const existingDate = new Date(existingCh.date).getTime();
      const incomingDate = new Date(e.date).getTime();
      
      if (!isNaN(incomingDate) && (isNaN(existingDate) || incomingDate > existingDate || !existingCh.src)) {
        existingCh.title = e.title || existingCh.title;
        existingCh.date = e.date || existingCh.date;
        existingCh.src = 'mangalivre';
        existingCh.mlId = e.mlId;
        existingCh.pages = []; // limpa páginas para re-resolver se a fonte mudou
        updated++;
      }
    }
  }
  
  if (added > 0 || updated > 0) {
    chObj.pt.sort((a, b) => a.number - b.number);
    fs.writeFileSync(chFilePath, JSON.stringify(chObj, null, 2), 'utf8');
  }
  return { added, updated };
}

// ---------- Scraper Modes ----------

// Processa um grupo de capítulos agrupados por mangá
async function processMangaChaptersGroup(mangaList, groupedChapters) {
  let newMangas = 0, newChapters = 0, updatedChapters = 0;
  const chCache = new Map(); // cache de arquivos de capítulos
  
  const entries = [...groupedChapters.entries()];
  
  // Identifica quais são novos e precisam de detalhes
  const newMangasToFetch = [];
  for (const [mSlug, chs] of entries) {
    const defaultTitle = chs[0].mangaTitle || mSlug;
    const m = findMangaMatch(defaultTitle, mSlug, mangaList);
    if (!m) {
      newMangasToFetch.push({ slug: mSlug, defaultTitle });
    }
  }

  // Busca detalhes em paralelo se houver novos mangás
  if (newMangasToFetch.length > 0) {
    console.log(`✨ Buscando detalhes de ${newMangasToFetch.length} novos mangás em paralelo...`);
    await runPool(newMangasToFetch, 15, async (item) => {
      const details = await fetchMangaDetails(item.slug, item.defaultTitle);
      const newM = {
        id: item.slug,
        slug: item.slug,
        title: details.title,
        altTitle: '',
        cover: details.cover,
        banner: details.cover,
        author: details.author,
        artist: details.artist,
        status: details.status,
        year: details.year,
        rating: 7.0,
        genres: details.genres,
        description: details.description,
        descriptionPt: details.description,
        chaptersCount: 0,
        lang: 'pt',
        hasPt: true,
        hasEn: false
      };
      mangaList.push(newM);
      newMangas++;
    });
  }

  // Processa as atualizações de capítulos
  for (const [mSlug, chs] of entries) {
    const defaultTitle = chs[0].mangaTitle || mSlug;
    let m = findMangaMatch(defaultTitle, mSlug, mangaList);
    
    if (!m) continue;
    m.hasPt = true;
    
    let cache = chCache.get(m.id);
    if (!cache) {
      cache = loadChapters(m.id);
      chCache.set(m.id, cache);
    }
    
    const { added, updated } = mergeChapters(m.id, cache.obj, cache.chFilePath, chs);
    newChapters += added;
    updatedChapters += updated;
    
    m.chaptersCount = Math.max(m.chaptersCount || 0, cache.obj.pt.length);
    if (added > 0 || updated > 0) {
      console.log(`   📥 ${m.title}: +${added} novos, ${updated} atualizados`);
    }
  }
  
  return { newMangas, newChapters, updatedChapters };
}

// Catálogo incremental — busca em lotes de 5 páginas simultâneas, para quando não tem novidade
async function runIncrementalUpdate() {
  console.log('🔄 MangaLivre Incremental Scrape...');
  const mangaList = loadMangaList();
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });

  const batchSize = 5;   // páginas simultâneas por lote
  const maxPages = 10;   // teto de segurança para incremental
  let page = 1;
  let totalNew = 0, totalUpdated = 0, totalNewMangas = 0;
  let hadNewActivity = true;

  while (hadNewActivity && page <= maxPages) {
    const pagesToFetch = [];
    for (let i = 0; i < batchSize && (page + i) <= maxPages; i++) {
      pagesToFetch.push(page + i);
    }

    console.log(`📡 Buscando páginas [${pagesToFetch.join(', ')}] em paralelo...`);

    const fetchPromises = pagesToFetch.map(p =>
      fetchJson(`${API_BASE}/chapter?page=${p}&per_page=${FEED_PAGE}&_fields=id,slug,title,date_gmt`)
        .then(data => ({ page: p, data }))
        .catch(e => ({ page: p, error: e }))
    );

    const batchResults = await Promise.all(fetchPromises);
    let allChapters = [];
    let endOfPagination = false;

    batchResults.sort((a, b) => a.page - b.page);

    for (const res of batchResults) {
      if (res.error) {
        console.error(`❌ Erro página ${res.page}: ${res.error.message}`);
        endOfPagination = true;
        continue;
      }
      if (!Array.isArray(res.data) || res.data.length === 0) {
        console.log(`🏁 Página ${res.page} vazia. Fim da varredura.`);
        endOfPagination = true;
        continue;
      }
      allChapters = allChapters.concat(res.data);
    }

    if (allChapters.length === 0) break;

    const grouped = new Map();
    for (const c of allChapters) {
      const { mangaTitle, mangaSlug, chapterNumber } = parseChapterTitle(c.title.rendered, c.slug);
      if (!mangaSlug || chapterNumber === null) continue;
      if (!grouped.has(mangaSlug)) grouped.set(mangaSlug, []);
      grouped.get(mangaSlug).push({
        number: chapterNumber,
        title: decodeEntities(c.title.rendered),
        date: c.date_gmt + 'Z',
        mlId: c.id,
        mangaTitle
      });
    }

    const { newMangas, newChapters, updatedChapters } = await processMangaChaptersGroup(mangaList, grouped);
    totalNew += newChapters;
    totalUpdated += updatedChapters;
    totalNewMangas += newMangas;

    if (endOfPagination || (newChapters === 0 && updatedChapters === 0 && newMangas === 0)) {
      if (!endOfPagination) console.log('⏹️ Nenhuma novidade. Early-stopping incremental.');
      hadNewActivity = false;
    } else {
      page += batchSize;
      // sem delay: o backoff exponencial no retry já protege contra rate-limit
    }
  }

  saveMangaList(mangaList);
  console.log(`\n🎉 Incremental MangaLivre concluída! Mangás novos: ${totalNewMangas}, Capítulos novos: ${totalNew}, Atualizados: ${totalUpdated}`);
}

// Catálogo completo — descobre o total de páginas via header e baixa tudo em paralelo
async function runFullCatalogUpdate() {
  console.log('📦 MangaLivre Varredura COMPLETA de capítulos...');
  const mangaList = loadMangaList();
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });

  // Página 1: pega os dados E o header X-WP-TotalPages
  console.log('📡 Página 1 — descobrindo total de páginas...');
  const firstUrl = `${API_BASE}/chapter?page=1&per_page=${FEED_PAGE}&_fields=id,slug,title,date_gmt`;
  const { data: firstPage, headers: firstHeaders } = await fetchJsonWithHeaders(firstUrl);
  const totalPages = parseInt(firstHeaders['x-wp-totalpages'] || '1', 10);
  console.log(`   Total de páginas: ${totalPages} (${totalPages * FEED_PAGE} capítulos aprox.)`);

  // Coleta todos os capítulos
  const allChapters = Array.isArray(firstPage) ? [...firstPage] : [];

  if (totalPages > 1) {
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    console.log(`📡 Baixando páginas 2–${totalPages} em paralelo (concorrência 20)...`);

    const pageResults = new Array(remainingPages.length).fill(null);
    await runPool(remainingPages, 20, async (p, idx) => {
      try {
        const data = await fetchJson(`${API_BASE}/chapter?page=${p}&per_page=${FEED_PAGE}&_fields=id,slug,title,date_gmt`);
        if (Array.isArray(data)) pageResults[idx] = data;
      } catch (e) {
        console.error(`   ⚠️ Erro na página ${p}: ${e.message}`);
      }
    });

    for (const result of pageResults) {
      if (result) allChapters.push(...result);
    }
  }

  console.log(`   ✅ ${allChapters.length} capítulos baixados. Processando...`);

  // Agrupa por mangá e processa
  const grouped = new Map();
  for (const c of allChapters) {
    const { mangaTitle, mangaSlug, chapterNumber } = parseChapterTitle(c.title.rendered, c.slug);
      if (!mangaSlug || chapterNumber === null) continue;
    if (!grouped.has(mangaSlug)) grouped.set(mangaSlug, []);
    grouped.get(mangaSlug).push({
      number: chapterNumber,
      title: decodeEntities(c.title.rendered),
      date: c.date_gmt + 'Z',
      mlId: c.id,
      mangaTitle
    });
  }

  const { newMangas, newChapters, updatedChapters } = await processMangaChaptersGroup(mangaList, grouped);

  saveMangaList(mangaList);
  console.log(`\n🎉 Completa MangaLivre concluída! Mangás novos: ${newMangas}, Capítulos novos: ${newChapters}, Atualizados: ${updatedChapters}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--all')) await runFullCatalogUpdate();
    else await runIncrementalUpdate();
}

main().catch(console.error);
