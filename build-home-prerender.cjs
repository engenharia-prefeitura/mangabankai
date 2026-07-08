// build-home-prerender.cjs — injeta conteúdo REAL no index.html em tempo de build:
// números das estatísticas + fileiras de mangás (Recentes, Populares, Novidades)
// com links internos. Assim o Google (e robôs de redes sociais) veem conteúdo e
// links no HTML estático, em vez da "casca" vazia renderizada só por JS.
//
// O JS da home re-renderiza essas seções no load (innerHTML), então para o
// usuário nada muda — só os robôs ganham o conteúdo estático.
//
// Idempotente: substitui o conteúdo entre marcadores <!--pr:X:s--> e <!--pr:X:e-->.
// Roda no build (vercel.json + npm run build). NÃO é commitado pelo GitHub Actions
// (index.html fica fora do git add do workflow), então o git mantém o template.
// Uso: node build-home-prerender.cjs

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INDEX_PATH = path.join(ROOT, 'index.html');
const DATA_LITE_PATH = path.join(ROOT, 'js', 'data-lite.js');
const HOME_JSON_PATH = path.join(ROOT, 'js', 'home.json');

const ROW_LIMIT = 24; // cards por fileira

function loadMangaData() {
  const content = fs.readFileSync(DATA_LITE_PATH, 'utf8');
  const marker = content.indexOf('MANGA_DATA = [');
  const start = content.indexOf('[', marker);
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < content.length; i++) {
    const c = content[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
  }
  return JSON.parse(content.substring(start, end));
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mangaUrl(m) {
  return (m.ssg && /^[a-z0-9-]+$/.test(m.id)) ? `/manga/${m.id}/` : `manga.html?id=${m.id}`;
}

function card(m) {
  const cover = m.cover || 'https://placehold.co/300x400/1a1a1a/444?text=?';
  return `<a class="manga-card" href="${mangaUrl(m)}"><div class="cover"><img src="${esc(cover)}" alt="${esc(m.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div><div class="info"><h3>${esc(m.title)}</h3></div></a>`;
}

function inject(html, key, content) {
  const re = new RegExp(`(<!--pr:${key}:s-->)([\\s\\S]*?)(<!--pr:${key}:e-->)`);
  if (!re.test(html)) { console.warn(`⚠ marcador pr:${key} não encontrado`); return html; }
  return html.replace(re, `$1${content}$3`);
}

function setStat(html, id, value) {
  const re = new RegExp(`(id="${id}">)[\\d.,]*(<)`);
  return html.replace(re, `$1${value}$2`);
}

function build() {
  const all = loadMangaData();
  const home = fs.existsSync(HOME_JSON_PATH) ? JSON.parse(fs.readFileSync(HOME_JSON_PATH, 'utf8')) : { recent: [], updated: {} };
  const byId = new Map(all.map(m => [m.id, m]));

  // Estatísticas reais
  const totalChapters = all.reduce((s, m) => s + (m.chaptersCount || 0), 0);
  const genres = new Set(); const authors = new Set();
  for (const m of all) {
    (m.genres || []).forEach(g => genres.add(g));
    if (m.author) authors.add(m.author);
  }
  const fmt = n => n.toLocaleString('pt-BR');

  // Fileiras
  const recent = (home.recent || []).map(r => byId.get(r.id)).filter(Boolean).slice(0, ROW_LIMIT);
  const popular = [...all].sort((a, b) => (b.chaptersCount || 0) - (a.chaptersCount || 0)).slice(0, ROW_LIMIT);
  const novidades = [...all].sort((a, b) => (b.year || 0) - (a.year || 0)).slice(0, ROW_LIMIT);

  let html = fs.readFileSync(INDEX_PATH, 'utf8');
  html = setStat(html, 'statMangas', fmt(all.length));
  html = setStat(html, 'statChapters', fmt(totalChapters));
  html = setStat(html, 'statGenres', fmt(genres.size));
  html = setStat(html, 'statAuthors', fmt(authors.size));
  html = inject(html, 'recent', recent.map(card).join(''));
  html = inject(html, 'popular', popular.map(card).join(''));
  html = inject(html, 'new', novidades.map(card).join(''));

  fs.writeFileSync(INDEX_PATH, html, 'utf8');
  return { mangas: all.length, chapters: totalChapters, genres: genres.size, authors: authors.size, recent: recent.length, popular: popular.length };
}

module.exports = { build };

if (require.main === module) {
  const r = build();
  console.log(`✅ home pré-renderizada: ${r.mangas} mangás, ${r.chapters} caps, ${r.genres} gêneros, ${r.authors} autores | fileiras: recent ${r.recent}, popular ${r.popular}`);
}
