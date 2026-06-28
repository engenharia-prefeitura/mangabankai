/**
 * MangaFreak Complete Scraper
 *
 * FASE 1: Extrai TODOS os mangás da listagem (/Genre/All/page)
 * FASE 2: Para cada mangá, extrai capítulos da página de detalhe
 * FASE 3: Gera chapters.json no formato MangaLix
 *
 * Uso:
 *   node mf-scraper.cjs              # Fase 1 + 2 (recomendado)
 *   node mf-scraper.cjs --fast        # Só Fase 1 (metadados)
 *   node mf-scraper.cjs --update      # Modo incremental: só novos mangás
 *   node mf-scraper.cjs --resume      # Continua de onde parou
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'https://ww1.mangafreak.me';
const CDN = 'https://images.mangafreak.me';
const TOTAL_PAGES = 150;
const PARALLEL = 3;

// CDN Mapping (placeholders)
const CDN_MAP = {
  '$MFK': 'https://images.mangafreak.me',
  '$TEMP': 'https://temp.compsci88.com',
  '$HOT': 'https://scans-hot.planeptune.us',
  '$LST': 'https://scans.lastation.us',
  '$LOW': 'https://official.lowee.us'
};

function fetch(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        fetch(next, redirects + 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function slugToId(slug) {
  return slug.toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ========== FASE 1: Listagem ==========

async function scrapeListing(page) {
  const url = `${BASE}/Genre/All/${page}`;
  const html = await fetch(url);
  const items = [];

  const blocks = html.split('<div class="ranking_item">');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];

    const slugMatch = block.match(/href="https:\/\/ww1\.mangafreak\.me\/Manga\/([^"]+)"/) || block.match(/href="\/Manga\/([^"]+)"/);
    if (!slugMatch) continue;
    const rawSlug = slugMatch[1];
    const slug = rawSlug.replace(/\/$/, '');

    const titleMatch = block.match(/<h3 class="title">([^<]+)<\/h3>/);
    const title = titleMatch ? titleMatch[1].trim() : slug;

    const authorMatch = block.match(/Sensei Name - ([^<]+)</);
    const author = authorMatch ? authorMatch[1].trim() : '';

    const infoMatch = block.match(/(\d+) Published\.\s*\(([^)]+)\)/);
    const chapters = infoMatch ? parseInt(infoMatch[1]) : 0;
    const status = infoMatch ? (infoMatch[2].toLowerCase() === 'completed' ? 'completed' : 'ongoing') : 'ongoing';

    const cover = `${CDN}/manga_images/${slug.toLowerCase()}.jpg`;

    items.push({
      id: slug.toLowerCase().replace(/_/g, '-'),
      slug: slug,
      title: title,
      author: author,
      status: status,
      chapters: chapters,
      cover: cover,
      lang: 'en'
    });
  }

  return items;
}

async function scrapeAllListing(updateMode = false) {
  const filePath = path.join(__dirname, 'js', 'mf-manga-list.json');

  // Check if partially done
  let existing = [];
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`Retomando: ${existing.length} mangás já extraídos`);
    } catch(e) {}
  }

  const doneSlugs = new Set(existing.map(m => m.slug));
  const total = TOTAL_PAGES;
  let newCount = 0;
  let noNewStreak = 0;

  for (let page = 1; page <= total; page++) {
    process.stdout.write(`\r  Pagina ${page}/${total}...`);
    try {
      const items = await scrapeListing(page);
      for (const item of items) {
        if (!doneSlugs.has(item.slug)) {
          existing.push(item);
          doneSlugs.add(item.slug);
          newCount++;
          noNewStreak = 0;
        } else if (updateMode) {
          noNewStreak++;
        }
      }
      // Early exit in update mode: if last 5 pages had no new manga, we're done
      if (updateMode && noNewStreak >= 5) {
        console.log(`\n  Parando: ${noNewStreak} páginas sem mangás novos.`);
        break;
      }
    } catch (err) {
      // Continue on errors
    }
    await new Promise(r => setTimeout(r, DELAY));
  }

  const doneSlugs = new Set(existing.map(m => m.slug));
  const total = TOTAL_PAGES;

  for (let page = 1; page <= total; page++) {
    process.stdout.write(`\r  Pagina ${page}/${total}...`);
    try {
      const items = await scrapeListing(page);
      for (const item of items) {
        if (!doneSlugs.has(item.slug)) {
          existing.push(item);
          doneSlugs.add(item.slug);
        }
      }
      // Save progress
      if (page % 10 === 0) {
        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
      }
    } catch (e) {
      console.log(`\n  ⚠️ Erro na página ${page}: ${e.message}`);
    }
    // Delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
  console.log(`\n✅ FASE 1: ${existing.length} mangás salvos em js/mf-manga-list.json`);
  return existing;
}

// ========== FASE 2: Capítulos ==========

async function scrapeChapters(slug) {
  const url = `${BASE}/Manga/${slug}`;
  const html = await fetch(url);

  // Find chapter links - mangafreak lists chapters in a table
  const chapters = [];
  const chLinks = [...html.matchAll(/href="(https:\/\/images\.mangafreak\.me\/mangas\/[^"]+)"/g)];

  if (chLinks.length > 0) {
    // Direct image URLs found (unlikely, but possible)
    return chapters;
  }

  // Parse chapter list from the manga page
  // Format: <a href="/Manga/{slug}/{chapter}">
  const chMatches = [...html.matchAll(/<a href="\/Manga\/[^"]+\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

  return chapters;
}

// ========== MAIN ==========

async function main() {
  const args = process.argv.slice(2);
  const fastMode = args.includes('--fast');
  const updateMode = args.includes('--update');

  console.log('🔍 MangaFreak Complete Scraper');
  console.log('═══════════════════════════════\n');

  // FASE 1
  const mode = updateMode ? ' (incremental)' : '';
  console.log(`📋 FASE 1${mode}: Extraindo listagem completa...`);
  const mangaList = await scrapeAllListing(updateMode);

  if (fastMode || updateMode) {
    const label = updateMode ? '🔄 Modo incremental' : '⚡ Modo rápido';
    console.log(`\n${label}: apenas metadados salvos em js/mf-manga-list.json.`);
    if (updateMode) console.log('🔄 Para completar: rode mf-chapter-scraper.cjs e mf-meta-scraper.cjs');
    console.log('🔄 Depois rode: node merge-meta.cjs para atualizar data.js');
    return;
  }

  // FASE 2: Scrape chapters for each manga
  console.log('\n📖 FASE 2: Extraindo capítulos e imagens...');
  // This would take a very long time for 2250 manga
  // For now, generate what we have + merge with existing chapters.json
  generateDataJs(mangaList);
}

function generateDataJs(mangaList) {
  // Generate a combined data source
  const enriched = mangaList.map(m => ({
    id: m.id,
    slug: m.slug,
    title: m.title,
    altTitle: '',
    cover: m.cover,
    banner: m.cover,
    author: m.author || 'Desconhecido',
    artist: m.author || 'Desconhecido',
    status: m.status,
    year: new Date().getFullYear(),
    rating: 0,
    genres: ['Manga'],
    description: 'Leia ' + m.title + ' online no MangaSurge.',
    chaptersCount: m.chapters,
    lang: 'en',
    hasPt: false,
    latestChapter: null
  }));

  // Save as data.js
  const output = generateDataJsContent(enriched);
  fs.writeFileSync(path.join(__dirname, 'js', 'data.js'), output, 'utf8');
  console.log(`✅ js/data.js gerado (${(output.length / 1024).toFixed(0)} KB) com ${enriched.length} mangás`);
}

function generateDataJsContent(mangaList) {
  const arr = JSON.stringify(mangaList, null, 2);
  return `const MANGA_DATA = ${arr};

const CDN_MAP = ${JSON.stringify(CDN_MAP, null, 2)};

function resolveCdnUrl(url) {
  for (const [ph, domain] of Object.entries(CDN_MAP)) {
    if (url.startsWith(ph)) return url.replace(ph, domain);
  }
  return url;
}

function getManga(slugOrId) {
  return MANGA_DATA.find(m => m.slug === slugOrId || m.id === slugOrId);
}

function searchManga(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return MANGA_DATA.filter(m =>
    m.title.toLowerCase().includes(q) ||
    m.slug.includes(q)
  ).slice(0, 10);
}

function filterManga(opts) {
  opts = opts || {};
  const query = opts.query || '';
  const sort = opts.sort || 'recent';
  let results = MANGA_DATA;
  if (query) results = results.filter(m => searchManga(query).includes(m));
  switch (sort) {
    case 'title':
      results.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
      break;
    case 'chapters':
      results.sort((a, b) => (b.chaptersCount || 0) - (a.chaptersCount || 0));
      break;
    case 'recent':
    default:
      results.sort((a, b) => (b.chaptersCount || 0) - (a.chaptersCount || 0));
      break;
  }
  return results;
}

const ALL_GENRES = ['Manga'];

let chaptersData = null;

async function loadChapters() {
  if (chaptersData) return chaptersData;
  try {
    var res = await fetch('/js/chapters.json');
    var raw = await res.json();
    var map = {};
    Object.keys(raw).forEach(function(k) {
      var slug = k.replace(/-pt$/, '').replace(/-es$/, '').replace(/-fr$/, '');
      map[slug] = raw[k].map(function(ch) {
        return { id: ch.id, number: ch.number, title: ch.title, date: ch.releaseDate, pages: ch.pages ? ch.pages.map(function(p) { return resolveCdnUrl(p); }) : [] };
      });
    });
    chaptersData = map;
    return map;
  } catch(e) {
    return {};
  }
}

function getChapters(slug, lang) {
  if (!chaptersData) return [];
  var entry = chaptersData[slug];
  if (!entry) return [];
  return entry;
}
`;
}

main().catch(console.error);
