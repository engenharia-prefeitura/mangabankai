// mangadex-scraper.cjs — adiciona mangás PT-BR populares do MangaDex que ainda
// não estão no site (fonte: API pública e documentada api.mangadex.org).
//
// Estático para metadados + lista de capítulos (js/chapters/<id>.json com
// src:"mangadex" e mdxId do capítulo). As PÁGINAS são resolvidas na hora da
// leitura por api/resolve-chapter.js (MangaDex@Home), pois as URLs são temporárias.
//
// Modos:  incremental (padrão) — adiciona um lote pequeno por execução + atualiza
//         capítulos dos mangadex recém-atualizados; útil pro agendador horário.
//         --all — preenche até o TARGET (padrão 1000) novos de uma vez.
//
// Roda no fluxo PT (workflow: pt-only / atualizar tudo / agendador). Uso manual:
//   node mangadex-scraper.cjs            (incremental)
//   node mangadex-scraper.cjs --all      (preenche até TARGET)
//   MDX_TARGET=50 node mangadex-scraper.cjs --all   (teste)

const fs = require('fs');
const path = require('path');
const { getCap } = require('./lib/scraper-config.cjs');

const API = 'https://api.mangadex.org';
const UA = 'MangaBankaiBot/1.0 (eng.dennylsonsantos@gmail.com)';
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, 'js', 'chapters');

// total mangadex desejado no site: MDX_TARGET (env) > scraper-config.json > 1000
const TARGET = getCap('mangadex', 'MDX_TARGET', 1000);
const FULL = process.argv.includes('--all');
const PER_RUN = FULL ? TARGET : 150;                              // novos por execução
const RATINGS = ['safe', 'suggestive'];                          // sem +18 neste lote
const THROTTLE = 280;                                            // ms entre chamadas (< 5/s)

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 && tries < 6) { await sleep(3000); return get(url, tries + 1); }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' @ ' + url.slice(0, 80));
  return res.json();
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'manga';
}

// ---------- data.js (mesma técnica dos outros scrapers) ----------
function bounds(content) {
  const marker = content.indexOf('MANGA_DATA = [');
  if (marker < 0) throw new Error('MANGA_DATA não encontrado em data.js');
  const startIdx = content.indexOf('[', marker);
  let depth = 0, inStr = false, esc = false, endIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    const c = content[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } } }
  }
  if (endIdx < 0) throw new Error('Array MANGA_DATA não fechado.');
  return { startIdx, endIdx };
}
let _rawData = '';
function loadMangaList() {
  _rawData = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(_rawData);
  return JSON.parse(_rawData.substring(startIdx, endIdx));
}
function saveMangaList(list) {
  const { startIdx, endIdx } = bounds(_rawData);
  fs.writeFileSync(DATA_JS_PATH, _rawData.substring(0, startIdx) + JSON.stringify(list, null, 2) + _rawData.substring(endIdx), 'utf8');
}

function loadChObj(id) {
  const p = path.join(CHAPTERS_DIR, id + '.json');
  if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {} }
  return { pt: [] };
}
function saveChObj(id, obj) {
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(CHAPTERS_DIR, id + '.json'), JSON.stringify(obj, null, 2), 'utf8');
}

// ---------- mapeamento MangaDex -> schema do site ----------
function pickTitle(att) {
  return att.title.en || att.title['pt-br'] || att.title['pt'] || att.title['ja-ro'] || Object.values(att.title)[0] || 'Sem título';
}
function mapManga(m, slug) {
  const att = m.attributes;
  const rels = m.relationships || [];
  const cover = (rels.find(r => r.type === 'cover_art') || {}).attributes;
  const author = (rels.find(r => r.type === 'author') || {}).attributes;
  const artist = (rels.find(r => r.type === 'artist') || {}).attributes;
  const genres = (att.tags || []).filter(t => t.attributes.group === 'genre' || t.attributes.group === 'theme')
    .map(t => t.attributes.name.en).filter(Boolean).slice(0, 8);
  if (att.contentRating === 'erotica' || att.contentRating === 'pornographic') genres.push('Adulto');
  const desc = (att.description && (att.description['pt-br'] || att.description['pt'] || att.description.en)) || '';
  const coverUrl = cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover.fileName}.512.jpg` : '';
  return {
    id: slug, slug, title: pickTitle(att), altTitle: '',
    cover: coverUrl ? `/api/img-proxy?url=${encodeURIComponent(coverUrl)}` : '',
    banner: '', author: (author && author.name) || 'Desconhecido', artist: (artist && artist.name) || (author && author.name) || 'Desconhecido',
    status: att.status === 'completed' ? 'completed' : 'ongoing',
    year: att.year || new Date().getFullYear(), rating: 0,
    genres: genres.length ? genres : ['Manga'],
    description: desc, descriptionPt: desc,
    chaptersCount: 0, lang: 'pt', hasPt: true, hasEn: false,
    source: 'mangadex', mdxId: m.id
  };
}

async function fetchPtChapters(mdxId) {
  const out = [];
  const seen = new Set();
  let offset = 0;
  for (let guard = 0; guard < 10; guard++) {
    const j = await get(`${API}/manga/${mdxId}/feed?translatedLanguage[]=pt-br&order[chapter]=asc&limit=500&offset=${offset}&includes[]=scanlation_group`);
    for (const c of (j.data || [])) {
      const num = c.attributes.chapter;
      if (num == null) continue;
      if (c.attributes.externalUrl) continue;          // hospedado fora do MangaDex@Home
      if (c.attributes.pages === 0) continue;          // sem páginas
      if (seen.has(String(num))) continue;            // 1 versão por número
      seen.add(String(num));
      out.push({
        number: num, title: c.attributes.title || '',
        date: (c.attributes.publishAt || '').slice(0, 10),
        src: 'mangadex', mdxId: c.id
      });
    }
    offset += 500;
    if (!j.data || j.data.length < 500 || offset >= (j.total || 0)) break;
    await sleep(THROTTLE);
  }
  out.sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
  return out;
}

async function* popularPages() {
  const rate = RATINGS.map(r => `&contentRating[]=${r}`).join('');
  for (let offset = 0; offset <= 9900; offset += 100) {
    let j;
    try {
      j = await get(`${API}/manga?limit=100&offset=${offset}&availableTranslatedLanguage[]=pt-br`
        + `&order[followedCount]=desc&includes[]=cover_art&includes[]=author&includes[]=artist${rate}`);
    } catch (e) { console.log('  (parou paginação:', e.message + ')'); break; }
    if (!j.data || j.data.length === 0) break;
    yield j.data;
    if (j.data.length < 100) break;
    await sleep(THROTTLE);
  }
}

async function main() {
  console.log(`📚 MangaDex scraper — modo: ${FULL ? 'FULL' : 'incremental'} | TARGET ${TARGET} | por execução ${PER_RUN}`);
  const list = loadMangaList();

  const titleSet = new Set();
  const idSet = new Set();
  let existingMdx = 0;
  for (const m of list) {
    idSet.add(m.id);
    if (m.title) titleSet.add(norm(m.title));
    if (m.altTitle) String(m.altTitle).split(',').forEach(t => { const n = norm(t); if (n) titleSet.add(n); });
    if (m.source === 'mangadex') existingMdx++;
  }
  let slots = Math.max(0, Math.min(PER_RUN, TARGET - existingMdx));
  console.log(`   mangadex no site: ${existingMdx} | vagas nesta execução: ${slots}`);
  if (slots === 0) { console.log('   alvo já atingido — nada a adicionar.'); return; }

  let added = 0, chaptersTotal = 0;
  outer:
  for await (const page of popularPages()) {
    for (const m of page) {
      if (slots <= 0) break outer;
      const att = m.attributes;
      // dedupe por título/altTitles contra TODO o acervo
      const variants = [];
      Object.values(att.title || {}).forEach(t => variants.push(t));
      (att.altTitles || []).forEach(o => Object.values(o).forEach(t => variants.push(t)));
      if (variants.some(t => titleSet.has(norm(t)))) continue;

      // id único
      let slug = slugify(pickTitle(att));
      if (idSet.has(slug)) { let i = 2; while (idSet.has(slug + '-' + i)) i++; slug = slug + '-' + i; }

      await sleep(THROTTLE);
      let chapters;
      try { chapters = await fetchPtChapters(m.id); } catch (e) { console.log('   feed falhou:', e.message); continue; }
      if (!chapters.length) continue;   // sem capítulos PT-BR utilizáveis

      const manga = mapManga(m, slug);
      manga.chaptersCount = chapters.length;
      list.push(manga);
      saveChObj(slug, { pt: chapters });
      idSet.add(slug);
      titleSet.add(norm(manga.title));
      added++; slots--; chaptersTotal += chapters.length;
      console.log(`   ✨ +${manga.title} (${chapters.length} caps) [${added}]`);
      await sleep(THROTTLE);
    }
  }

  saveMangaList(list);
  console.log(`\n🎉 MangaDex: ${added} mangás novos, ${chaptersTotal} capítulos. Total mangadex agora: ${existingMdx + added}.`);
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(0); });
