const fs = require('fs');
const path = require('path');
const { fetchUrl, parseMeta, getChapters } = require('../madara-scraper.cjs');

const src = { name: 'mugiwaras', domain: 'mugiwarasoficial.com', cpt: 'manga', lang: 'pt', adult: false, pagesMode: 'lazy' };
const slug = 'bleach-manga';
const id = `${src.name}-${slug}`;

const DATA_JS_PATH = path.join(__dirname, '..', 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, '..', 'js', 'chapters');

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

function loadMangaList() {
  const raw = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(raw);
  return JSON.parse(raw.substring(startIdx, endIdx));
}

function saveMangaList(list) {
  const raw = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(raw);
  fs.writeFileSync(DATA_JS_PATH, raw.substring(0, startIdx) + JSON.stringify(list, null, 2) + raw.substring(endIdx), 'utf8');
}

async function main() {
  console.log(`Adding Bleach from Mugiwaras to MangaBankai...`);
  
  const mangaUrl = `https://${src.domain}/${src.cpt}/${slug}/`;
  console.log(`Fetching manga info from ${mangaUrl} ...`);
  const html = await fetchUrl(mangaUrl);
  const meta = parseMeta(html, src);
  console.log("Metadata parsed:", {
    title: meta.title,
    author: meta.author,
    artist: meta.artist,
    status: meta.status,
    year: meta.year,
    cover: meta.cover
  });
  
  console.log(`Fetching chapters...`);
  const chapters = await getChapters(src, slug);
  console.log(`Found ${chapters.length} chapters.`);
  if (!chapters.length) {
    console.error("No chapters found. Aborting.");
    return;
  }
  
  const chObj = { [src.lang]: [] };
  for (const ch of chapters) {
    chObj[src.lang].push({
      id: `${id}-ch-${ch.number}`,
      number: ch.number,
      title: ch.title,
      date: new Date().toISOString().slice(0, 10),
      pages: [], // lazy mode (pages resolved on demand)
      src: src.name,
      chapterUrl: ch.url
    });
  }
  
  const finalManga = {
    id,
    slug,
    title: meta.title,
    altTitle: 'Bleach Manga Completo',
    cover: meta.cover ? `/api/img-proxy?url=${encodeURIComponent(meta.cover)}` : '',
    banner: meta.cover ? `/api/img-proxy?url=${encodeURIComponent(meta.cover)}` : '',
    author: meta.author,
    artist: meta.artist,
    status: meta.status,
    year: meta.year,
    rating: 9.2, // set a good rating for Bleach
    genres: meta.genres.length ? meta.genres : ['Ação', 'Aventura', 'Shounen', 'Supernatural'],
    description: meta.synopsis,
    descriptionPt: meta.synopsis,
    chaptersCount: chObj[src.lang].length,
    lang: src.lang,
    hasPt: true,
    hasEn: false,
    source: src.name
  };
  
  // Save chapters file
  const chPath = path.join(CHAPTERS_DIR, `${id}.json`);
  fs.writeFileSync(chPath, JSON.stringify(chObj, null, 2), 'utf8');
  console.log(`Saved chapters to ${chPath}`);
  
  // Update data.js
  const list = loadMangaList();
  const index = list.findIndex(m => m.id === id);
  if (index >= 0) {
    list[index] = finalManga;
    console.log("Updated Bleach entry in data.js");
  } else {
    list.push(finalManga);
    console.log("Added Bleach entry in data.js");
  }
  
  saveMangaList(list);
  console.log("Saved data.js successfully!");
  
  // Trigger builds
  console.log("Rebuilding site...");
  try { require('../build-lite.cjs').buildLite(); } catch (e) { console.error("buildLite error:", e.message); }
  try { require('../build-home.cjs').buildHome(); } catch (e) { console.error("buildHome error:", e.message); }
  
  console.log("Finished successfully! Bleach is now registered.");
}

main().catch(console.error);
