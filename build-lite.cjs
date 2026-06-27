// build-lite.cjs — gera js/data-lite.js (catálogo enxuto p/ as telas de listagem)
// e js/manga-search.json (índice minimal para busca no admin da Vercel).
// Uso:  node build-lite.cjs        (ou chamado automaticamente após salvar data.js)

const fs = require('fs');
const path = require('path');

const DATA_JS_PATH   = path.join(__dirname, 'js', 'data.js');
const LITE_JS_PATH   = path.join(__dirname, 'js', 'data-lite.js');
const SEARCH_JS_PATH = path.join(__dirname, 'js', 'manga-search.json');

function bounds(content) {
  const marker = content.indexOf('MANGA_DATA = [');
  if (marker < 0) throw new Error('MANGA_DATA não encontrado');
  const startIdx = content.indexOf('[', marker);
  // Parser string-aware: ignora [ e ] dentro de strings JSON
  let depth = 0, inStr = false, esc = false, endIdx = -1;
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
  if (endIdx < 0) throw new Error('Array MANGA_DATA não fechado — data.js corrompido.');
  return { startIdx, endIdx };
}

// Padrões conhecidos de placeholder/fallback que não devem ser exibidos
const PLACEHOLDER_PATTERNS = [
  'placeholder.jpg',
  'placeholder.png',
  'placeholder.webp',
  '/arrumar-tema',
  '/wp-content/themes/',
  'placehold.co',
  'via.placeholder.com',
  'no-image',
  'noimage',
  'sem-capa'
];

function isPlaceholder(cover) {
  return PLACEHOLDER_PATTERNS.some(p => cover.includes(p));
}

function proxyCover(cover) {
  if (!cover) return '';
  // Descarta placeholders antes de qualquer outra lógica
  if (isPlaceholder(cover)) return '';
  const allowedPrefixes = [
    'https://images.mangafreak.me/',
    'https://leituramanga.net/',
    'https://leituramanga.com/',
    'https://cdn.leituramanga.net/',
    'https://mundohentaioficial.com/',
    'https://mangalivre.blog/',
    'https://uploads.mangadex.org/'
  ];
  const shouldProxy = allowedPrefixes.some(prefix => cover.startsWith(prefix));
  if (shouldProxy) {
    return '/api/img-proxy?url=' + encodeURIComponent(cover);
  }
  return cover;
}

function slimManga(m) {
  const out = {
    id: m.id, slug: m.slug, title: m.title, altTitle: m.altTitle || '',
    cover: proxyCover(m.cover), status: m.status, rating: m.rating,
    chaptersCount: m.chaptersCount || 0, genres: m.genres || [],
    year: m.year, author: m.author,
    lang: m.lang, hasPt: !!m.hasPt, hasEn: !!m.hasEn
  };
  if (m.latestChapter != null) out.latestChapter = m.latestChapter;
  if (m.hidden) out.hidden = true;
  const d = m.description || m.descriptionPt || '';
  if (d) out.description = d.length > 180 ? d.slice(0, 180) : d;
  return out;
}

function buildLite() {
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(content);
  const arr = JSON.parse(content.substring(startIdx, endIdx));
  const slim = arr.map(slimManga);

  // data-lite.js — mantém rodapé do data.js (funções getManga, searchManga, etc.)
  const tail = content.substring(endIdx);
  if (!tail || !/function\s+getManga/.test(tail) || !/function\s+searchManga/.test(tail)) {
    throw new Error('Rodapé do data.js incompleto — rode: node merge-meta.cjs primeiro.');
  }
  fs.writeFileSync(LITE_JS_PATH, 'let MANGA_DATA = ' + JSON.stringify(slim, null, 0) + tail, 'utf8');

  // manga-search.json — índice minimal para busca server-side no admin da Vercel
  const searchIndex = arr.map(m => ({
    id: m.id,
    slug: m.slug || m.id,
    title: m.title || '',
    cover: proxyCover(m.cover),
    source: m.source || ''
  }));
  fs.writeFileSync(SEARCH_JS_PATH, JSON.stringify(searchIndex), 'utf8');

  const before = fs.statSync(DATA_JS_PATH).size;
  const after  = fs.statSync(LITE_JS_PATH).size;
  return { mangas: slim.length, before, after };
}

module.exports = { buildLite };

if (require.main === module) {
  const r = buildLite();
  const pct = Math.round((1 - r.after / r.before) * 100);
  console.log(`✅ data-lite.js gerado: ${r.mangas} mangás | ${(r.before/1048576).toFixed(2)}MB → ${(r.after/1048576).toFixed(2)}MB (-${pct}%)`);
  console.log(`✅ manga-search.json gerado: ${r.mangas} entradas`);
}
