// madara-scraper.cjs — scraper genérico para sites de mangá no tema Madara.
// Atende várias fontes +18 com uma config só. Páginas ESTÁTICAS (guardadas) →
// leem no site público, 100% nuvem.
//
// Pipeline Madara: sitemap (wp-manga-sitemap*) → metadados da página → capítulos
// via POST /<cpt>/<slug>/ajax/chapters/ → imagens em .reading-content.
//
// Dedup por idioma: se a mesma obra vier de 2 fontes, mantém a com MAIS capítulos.
// Gêneros banidos pela Adsterra (loli/shota) viram "Outros gêneros" (não exclui a obra).
//
// Modos: incremental (padrão) | --all. Env: MADARA_MAX (mangás/execução),
//        MADARA_ONLY=tankouhentai,tiamanhwa (limita as fontes).
// Uso: node madara-scraper.cjs [--all]

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, 'js', 'chapters');

// ── Fontes (todas Madara) ──────────────────────────────────────────────────
// adult:true  → força rótulo "Hentai" e relabel de gêneros banidos (sites +18).
// adult:false → mangá mainstream (não força Hentai).
// chaptersFrom:'sitemap' → descobre capítulos pelos wp-manga-chapters-sitemap*.xml
//   (para sites cujo endpoint /ajax/chapters/ está desativado).
// pagesMode:'lazy' → guarda só a lista de capítulos (chapterUrl) com pages:[],
//   resolvidas sob demanda pelo /resolve-chapter (Vercel alcança esses sites).
//   Torna o scrape do site inteiro ~1-2 min (sem baixar cada capítulo).
//   Capítulos já pré-gravados (com pages) são preservados.
const ALL_SOURCES = [
  { name: 'tankouhentai',  domain: 'tankouhentai.com',  cpt: 'manga',  lang: 'pt', adult: true,  pagesMode: 'lazy' },
  { name: 'tiamanhwa',     domain: 'tiamanhwa.com',     cpt: 'manhwa', lang: 'pt', adult: true,  pagesMode: 'lazy' },
  { name: 'mangadistrict', domain: 'mangadistrict.com', cpt: 'series', lang: 'en', adult: true,  pagesMode: 'lazy' },
  { name: 'mangalivre-to', domain: 'mangalivre.to',     cpt: 'manga',  lang: 'pt', adult: false, chaptersFrom: 'sitemap', pagesMode: 'lazy' }
];
const ONLY = (process.env.MADARA_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const SOURCES = ONLY.length ? ALL_SOURCES.filter(s => ONLY.includes(s.name)) : ALL_SOURCES;

const FULL = process.argv.includes('--all');
const MAX_MANGAS = parseInt(process.env.MADARA_MAX || (FULL ? '99999' : '20'), 10);
const THROTTLE = 150;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Gêneros banidos pela Adsterra → relabel para "Outros gêneros" (NÃO exclui a obra)
const BANNED_GENRE = /loli|lolicon|shota|shotacon|toddler|infantil|crian|menor|child\b|kid\b/i;
const OUTROS = 'Outros gêneros';

function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
    .replace(/&#8217;|&#039;|&#39;|&rsquo;|&lsquo;/g, "'").replace(/&#8220;|&#8221;|&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-')
    .replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, ' ').trim();
}
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(uncensored|sem censura|hentai|ptbr|pt-br)\b/gi, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function fetchUrl(url, opts = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('redirects'));
    const client = url.startsWith('https') ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br'
    };
    if (opts.ajax) { headers['X-Requested-With'] = 'XMLHttpRequest'; headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (opts.referer) headers['Referer'] = opts.referer;
    const req = client.request(url, { method: opts.method || 'GET', headers, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchUrl(next, opts, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks); const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') return resolve(zlib.gunzipSync(buf).toString('utf8'));
          if (enc === 'deflate') return resolve(zlib.inflateSync(buf).toString('utf8'));
          if (enc === 'br') return resolve(zlib.brotliDecompressSync(buf).toString('utf8'));
          resolve(buf.toString('utf8'));
        } catch (e) { resolve(buf.toString('utf8')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ── data.js ────────────────────────────────────────────────────────────────
function bounds(content) {
  const marker = content.indexOf('MANGA_DATA = [');
  if (marker < 0) throw new Error('MANGA_DATA não encontrado');
  const startIdx = content.indexOf('[', marker);
  let depth = 0, inStr = false, esc = false, endIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    const c = content[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } } }
  }
  if (endIdx < 0) throw new Error('array não fechado');
  return { startIdx, endIdx };
}
let _raw = '';
function loadMangaList() { _raw = fs.readFileSync(DATA_JS_PATH, 'utf8'); const { startIdx, endIdx } = bounds(_raw); return JSON.parse(_raw.substring(startIdx, endIdx)); }
function saveMangaList(list) { const { startIdx, endIdx } = bounds(_raw); fs.writeFileSync(DATA_JS_PATH, _raw.substring(0, startIdx) + JSON.stringify(list, null, 2) + _raw.substring(endIdx), 'utf8'); }
function saveChObj(id, obj) { if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true }); fs.writeFileSync(path.join(CHAPTERS_DIR, id + '.json'), JSON.stringify(obj, null, 2), 'utf8'); }

// ── parsers Madara ─────────────────────────────────────────────────────────
async function collectSlugs(src) {
  const base = `https://${src.domain}`;
  const sitemaps = new Set();
  try {
    const idx = await fetchUrl(`${base}/sitemap_index.xml`);
    for (const m of idx.matchAll(/<loc>([^<]*wp-manga-sitemap[0-9]*\.xml)<\/loc>/gi)) sitemaps.add(m[1]);
  } catch (e) {}
  if (!sitemaps.size) sitemaps.add(`${base}/wp-manga-sitemap.xml`);
  const slugs = [];
  for (const sm of sitemaps) {
    try {
      const xml = await fetchUrl(sm);
      for (const m of xml.matchAll(new RegExp(`<loc>(https?://${src.domain.replace('.', '\\.')}/${src.cpt}/([^/<]+)/)</loc>`, 'gi'))) slugs.push(m[2]);
      await sleep(THROTTLE);
    } catch (e) {}
  }
  // Fontes por sitemap de capítulos: o sitemap de mangás costuma ser limitado,
  // então também incluímos todo slug que tenha capítulos listados.
  if (src.chaptersFrom === 'sitemap') {
    try {
      const map = await buildChapterSitemapMap(src);
      for (const slug of map.keys()) slugs.push(slug);
    } catch (e) {}
  }
  return [...new Set(slugs)];
}

function parseMeta(html, src) {
  const get = (re) => { const m = html.match(re); return m ? decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : ''; };
  let title = get(/property="og:title"\s+content="([^"]+)"/i)
           || get(/class="post-title"[^>]*>\s*<h1[^>]*>([^<]+)/i)
           || get(/<h1[^>]*>([^<]+)<\/h1>/i)
           || get(/<title>([^<]+)<\/title>/i);
  title = title.replace(/\s*[-–|]\s*(Hentai|Manga|Manhwa|Tankoubon|Read.*|Mang[áa]|Manga\s*District).*$/i, '').trim();

  const cover = (html.match(/class="summary_image"[\s\S]{0,260}?<img[^>]+(?:data-src|src)="([^"]+)"/i) || [])[1] || '';

  let genres = [];
  const g = html.match(/class="genres-content"[^>]*>([\s\S]*?)<\/div>/i);
  if (g) genres = [...new Set([...g[1].matchAll(/>([^<]+)<\/a>/g)].map(m => decodeEntities(m[1]).trim()).filter(Boolean))];
  // relabel banidos (não exclui a obra)
  genres = [...new Set(genres.map(x => BANNED_GENRE.test(x) ? OUTROS : x))];
  if (src.adult) {
    // Sites +18: garante o rótulo Hentai para caírem no modo adulto.
    if (!genres.length) genres = ['Hentai'];
    if (!genres.some(x => /hentai|adult/i.test(x))) genres.push('Hentai');
  } else {
    // Mainstream: não força Hentai; só um fallback neutro se vier vazio.
    if (!genres.length) genres = ['Manga'];
  }
  genres = genres.slice(0, 14);

  const itemVal = (label) => {
    const re = new RegExp('post-content_item[^>]*>[\\s\\S]{0,120}?summary-heading[^>]*>\\s*<h5>\\s*' + label + '[\\s\\S]{0,300}?summary-content[^>]*>([\\s\\S]*?)<\\/div>', 'i');
    const m = html.match(re); return m ? decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
  };
  const author = (html.match(/class="author-content"[^>]*>\s*<a[^>]*>([^<]+)/i) || [])[1] || itemVal('Autho?r') || 'Desconhecido';
  const artist = (html.match(/class="artist-content"[^>]*>\s*<a[^>]*>([^<]+)/i) || [])[1] || author;
  const statusRaw = (html.match(/class="post-status"[\s\S]*?summary-content[^>]*>\s*([^<]+)/i) || [])[1] || itemVal('Status');
  const status = /complet|finaliz/i.test(statusRaw) ? 'completed' : 'ongoing';
  const relRaw = itemVal('(?:Release|Lançamento|Ano)');
  const year = parseInt((relRaw.match(/\d{4}/) || [])[0], 10) || new Date().getFullYear();
  const synopsis = get(/class="(?:summary__content|description-summary|manga-excerpt)[^"]*"[^>]*>([\s\S]*?)<\/div>/i).slice(0, 600);
  const postId = (html.match(/data-id="(\d+)"/i) || html.match(/shortlink[^>]+\?p=(\d+)/i) || [])[1] || '';

  return { title, cover: decodeEntities(cover), genres, author: decodeEntities(author), artist: decodeEntities(artist), status, year, synopsis, postId };
}

// Cache por domínio: slug -> [{number, url, title}] montado a partir dos
// wp-manga-chapters-sitemap*.xml. Usado por fontes com chaptersFrom:'sitemap'.
const _chapterSitemapCache = new Map();
async function buildChapterSitemapMap(src) {
  if (_chapterSitemapCache.has(src.domain)) return _chapterSitemapCache.get(src.domain);
  const base = `https://${src.domain}`;
  const sitemaps = new Set();
  try {
    const idx = await fetchUrl(`${base}/sitemap_index.xml`);
    for (const m of idx.matchAll(/<loc>([^<]*wp-manga-chapters-sitemap[0-9]*\.xml)<\/loc>/gi)) sitemaps.add(m[1]);
  } catch (e) {}
  const map = new Map(); // slug -> Map(number -> {number,url,title})
  const chRe = new RegExp(`<loc>(https?://${src.domain.replace(/\./g, '\\.')}/${src.cpt}/([^/<]+)/(?:cap[ií]tulo|chapter|cap)-([0-9.]+)/?)</loc>`, 'gi');
  for (const sm of sitemaps) {
    let xml;
    try { xml = await fetchUrl(sm); } catch (e) { continue; }
    for (const m of xml.matchAll(chRe)) {
      const [, url, slug, num] = m;
      if (!map.has(slug)) map.set(slug, new Map());
      const inner = map.get(slug);
      if (!inner.has(num)) inner.set(num, { number: num, url, title: `Capítulo ${num}` });
    }
    await sleep(THROTTLE);
  }
  _chapterSitemapCache.set(src.domain, map);
  return map;
}

async function getChapters(src, slug) {
  if (src.chaptersFrom === 'sitemap') {
    const map = await buildChapterSitemapMap(src);
    const inner = map.get(slug);
    if (!inner) return [];
    return [...inner.values()].sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
  }
  const url = `https://${src.domain}/${src.cpt}/${slug}/ajax/chapters/`;
  let html;
  try { html = await fetchUrl(url, { method: 'POST', ajax: true, referer: `https://${src.domain}/${src.cpt}/${slug}/` }); }
  catch (e) { return []; }
  const map = new Map();
  for (const m of html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+\/[^"\/]+\/)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = m[1]; const txt = m[2].replace(/<[^>]+>/g, '').trim();
    const nm = (u.match(/(?:chapter|cap[ií]tulo|cap)-?([0-9.]+)\/?$/i) || txt.match(/([0-9.]+)/) || [])[1];
    if (nm && !map.has(nm)) map.set(nm, { number: nm, url: u, title: txt || `Cap. ${nm}` });
  }
  return [...map.values()].sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
}

function parsePages(html) {
  // <img id="image-N" ... class="wp-manga-chapter-img" src=" URL "> (ordem de atributos
  // varia, e o src costuma vir com espaço — daí o trim).
  const imgs = [];
  const grab = (tag) => { const m = tag.match(/(?:data-src|data-lazy-src|src)="\s*([^"]+?)\s*"/i); if (m) imgs.push(m[1].trim()); };
  for (const m of html.matchAll(/<img[^>]*\bclass="[^"]*wp-manga-chapter-img[^"]*"[^>]*>/gi)) grab(m[0]);
  if (!imgs.length) for (const m of html.matchAll(/<img[^>]*\bid="image-\d+"[^>]*>/gi)) grab(m[0]);
  return [...new Set(imgs)].filter(u => /^https?:\/\//.test(u) && !/logo|avatar|icon|cropped|-\d+x\d+\.(?:jpe?g|png|webp)/i.test(u));
}

// Produz o mangá (rede + parsing) SEM mexer em estado compartilhado.
// Retorna { id, slug, meta, chObj, manga } ou null. Seguro para rodar em paralelo.
async function produceManga(src, slug) {
  const id = `${src.name}-${slug}`;
  let html;
  try { html = await fetchUrl(`https://${src.domain}/${src.cpt}/${slug}/`); } catch (e) { return null; }
  const meta = parseMeta(html, src);
  if (!meta.title) return null;

  const chapters = await getChapters(src, slug);
  if (!chapters.length) return null;

  const chObj = { [src.lang]: [] };
  const chPath = path.join(CHAPTERS_DIR, id + '.json');
  let existingChObj = {};
  if (fs.existsSync(chPath)) {
    try { existingChObj = JSON.parse(fs.readFileSync(chPath, 'utf8')); } catch (e) {}
  }
  const existingChMap = new Map((existingChObj[src.lang] || []).map(c => [String(c.number), c]));

  const chaptersToScrape = [];
  for (const ch of chapters) {
    const exist = existingChMap.get(String(ch.number));
    if (exist && exist.pages && exist.pages.length > 0) {
      chObj[src.lang].push(exist);            // já pré-gravado → mantém (leitura instantânea)
    } else if (src.pagesMode === 'lazy') {
      // Modo lazy: guarda só a URL; páginas resolvidas sob demanda no reader.
      chObj[src.lang].push({
        id: `${id}-ch-${ch.number}`, number: ch.number, title: ch.title,
        date: new Date().toISOString().slice(0, 10), pages: [], src: src.name, chapterUrl: ch.url
      });
    } else {
      chaptersToScrape.push(ch);
    }
  }

  if (chaptersToScrape.length > 0) {
    const CONCURRENCY = 4;
    let nextChIdx = 0;
    const scrapeWorker = async () => {
      while (nextChIdx < chaptersToScrape.length) {
        const ch = chaptersToScrape[nextChIdx++];
        if (!ch) continue;
        await sleep(THROTTLE);
        let chHtml;
        try { chHtml = await fetchUrl(ch.url, { referer: `https://${src.domain}/` }); } catch (e) { continue; }
        const pages = parsePages(chHtml);
        if (!pages.length) continue;
        chObj[src.lang].push({
          id: `${id}-ch-${ch.number}`, number: ch.number, title: ch.title,
          date: new Date().toISOString().slice(0, 10), pages, src: src.name, chapterUrl: ch.url
        });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, scrapeWorker));
  }
  if (!chObj[src.lang].length) return null;
  chObj[src.lang].sort((a, b) => parseFloat(a.number) - parseFloat(b.number));

  const manga = {
    id, slug, title: meta.title, altTitle: '', cover: meta.cover, banner: meta.cover,
    author: meta.author, artist: meta.artist, status: meta.status, year: meta.year, rating: 0,
    genres: meta.genres, description: meta.synopsis, descriptionPt: src.lang === 'pt' ? meta.synopsis : '',
    chaptersCount: chObj[src.lang].length, lang: src.lang, hasPt: src.lang === 'pt', hasEn: src.lang === 'en',
    source: src.name
  };
  return { id, slug, meta, chObj, manga };
}

async function main() {
  console.log(`📚 Madara scraper — ${FULL ? 'FULL' : 'incremental'} | fontes: ${SOURCES.map(s => s.name).join(', ')} | máx ${MAX_MANGAS}`);
  const list = loadMangaList();
  const byId = new Map(list.map(m => [m.id, m]));
  // índice por idioma+títuloNorm pra dedup entre fontes madara
  const titleIndex = new Map(); // `${lang}|${norm}` -> manga
  for (const m of list) titleIndex.set((m.lang || 'pt') + '|' + norm(m.title), m);

  let added = 0, updated = 0, deduped = 0, processed = 0;
  for (const src of SOURCES) {
    if (processed >= MAX_MANGAS) break;
    console.log(`\n── ${src.name} (${src.domain}) ──`);
    let slugs = await collectSlugs(src);
    console.log(`  ${slugs.length} títulos no sitemap.`);
    // incremental: prioriza os que faltam/quebrados desta fonte
    const existIds = new Set(list.filter(m => m.source === src.name).map(m => m.id));
    if (!FULL) slugs = slugs.filter(s => !existIds.has(`${src.name}-${s}`) || !byId.get(`${src.name}-${s}`).cover);

    // Aplica um resultado produzido (dedup + escrita) de forma SERIALIZADA:
    // é síncrono e não tem await, então nunca intercala entre workers.
    let sinceSave = 0;
    const applyResult = (r) => {
      const { id, meta, chObj, manga } = r;
      const key = src.lang + '|' + norm(meta.title);
      const rival = titleIndex.get(key);
      if (rival && rival.id !== id) {
        if ((rival.chaptersCount || 0) >= manga.chaptersCount) { deduped++; return; } // rival ganha
        const ri = list.findIndex(m => m.id === rival.id);
        if (ri >= 0) list.splice(ri, 1);
        byId.delete(rival.id);
        try { fs.unlinkSync(path.join(CHAPTERS_DIR, rival.id + '.json')); } catch (e) {}
        deduped++;
      }
      saveChObj(id, chObj);
      const existing = byId.get(id);
      if (existing) { Object.assign(existing, manga); updated++; }
      else { list.push(manga); byId.set(id, manga); added++; }
      titleIndex.set(key, manga);
      if (++sinceSave >= 25) { saveMangaList(list); sinceSave = 0; }
      console.log(`  ${existing ? '♻️' : '✨'} ${meta.title} (${manga.chaptersCount} caps, ${meta.genres.length} gen)`);
    };

    // Pool de workers: a REDE roda em paralelo (produceManga), a ESCRITA é serial.
    const MANGA_CONCURRENCY = parseInt(process.env.MADARA_CONCURRENCY || '6', 10);
    let nextIdx = 0;
    const worker = async () => {
      while (true) {
        if (processed >= MAX_MANGAS) return;
        const i = nextIdx++;
        if (i >= slugs.length) return;
        processed++;
        await sleep(THROTTLE);
        let r = null;
        try { r = await produceManga(src, slugs[i]); } catch (e) { r = null; }
        if (r) applyResult(r);
      }
    };
    await Promise.all(Array.from({ length: MANGA_CONCURRENCY }, worker));
    saveMangaList(list); // salva o restante ao fim de cada fonte
  }
  console.log(`\n🎉 Madara: ${added} novos, ${updated} atualizados, ${deduped} dedup.`);
}

if (require.main === module) {
  main().catch(e => { console.error('ERRO:', e.message); process.exit(0); });
}
module.exports = { fetchUrl, collectSlugs, parseMeta, getChapters, parsePages, SOURCES, ALL_SOURCES };
