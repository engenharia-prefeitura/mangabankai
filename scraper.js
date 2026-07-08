/**
 * MangaFire Scraper — Extrai dados do MangaFire e gera data.js
 *
 * Como usar:
 *   1. node scraper.js                       (extrai 5 mangás de teste)
 *   2. node scraper.js --all                 (extrai TODOS os mangás)
 *   3. node scraper.js --ids=one-piecee.dkw  (extrai específicos)
 *
 * Não requer dependências — usa Node.js puro
 */

const https = require('https');
const http = require('http');
const fs = require('fs');

const BASE = 'https://mangafire.to';
const SITEMAP_BASE = `${BASE}/sitemap-list-`;
const TOTAL_SITEMAPS = 54;
const OUTPUT = 'js/data.js';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractMangaIds(sitemapXml) {
  const urls = [...sitemapXml.matchAll(/<loc>(https:\/\/mangafire\.to\/manga\/([^<]+))<\/loc>/g)];
  return urls.map(m => ({ url: m[1], id: m[2] }));
}

function cleanupSlug(str) {
  return str.replace(/\s+/g, ' ').trim();
}

function extractMangaPage(html, id) {
  const manga = { id, chapters: [] };

  // Title
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  if (!titleMatch) {
    const titleMatch2 = html.match(/<h2[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h2>/);
    manga.title = titleMatch2 ? cleanupSlug(titleMatch2[1]) : id;
  } else {
    manga.title = cleanupSlug(titleMatch[1]);
  }

  // Fallback title from URL
  if (!manga.title || manga.title.length > 60) {
    manga.title = id.split('.')[0].replace(/-/g, ' ').replace(/(.)$/, '$1');
  }

  // Alt titles (from h2 or subheader)
  const altMatch = html.match(/<h2[^>]*>([^<]+)<\/h2>/);
  manga.altTitle = altMatch ? cleanupSlug(altMatch[1]).substring(0, 60) : '';

  // Cover image
  const coverMatch = html.match(/<img[^>]*src="([^"]+)"[^>]*class="[^"]*(?:cover|poster|thumbnail)[^"]*"[^>]*>/i)
    || html.match(/class="[^"]*(?:cover|poster)[^"]*"[^>]*src="([^"]+)"/i)
    || html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
    || html.match(/<img[^>]*id="cover"[^>]*src="([^"]+)"/i);
  manga.cover = coverMatch ? coverMatch[1] : `https://placehold.co/300x400/1a1a1a/666?text=${encodeURIComponent(manga.title)}`;

  // Banner
  const bannerMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
  manga.banner = bannerMatch ? bannerMatch[1] : manga.cover;

  // Status
  const statusMatch = html.match(/Releasing|Completed|On Hiatus|Discontinued|Not Yet Published/i);
  manga.status = statusMatch ? statusMatch[0].toLowerCase().replace(/\s+/g, '-') : 'ongoing';
  if (manga.status === 'releasing') manga.status = 'ongoing';

  // Author
  const authorMatch = html.match(/Author:\s*([^<]+)<\/a>/i) || html.match(/Author[^<]*<[^>]*>([^<]+)<\/a>/i);
  manga.author = authorMatch ? cleanupSlug(authorMatch[1]).replace(/^by\s+/i, '') : 'Desconhecido';
  manga.artist = manga.author;

  // Year
  const yearMatch = html.match(/(?:Published|Year):\s*([^<]+)/i);
  if (yearMatch) {
    const yearNum = yearMatch[1].match(/(\d{4})/);
    manga.year = yearNum ? parseInt(yearNum[1]) : 2020;
  } else {
    manga.year = 2020;
  }

  // Rating
  const ratingMatch = html.match(/(\d+\.\d+)\s*\/\s*10/) || html.match(/(\d+\.\d+)\s*MAL/);
  manga.rating = ratingMatch ? parseFloat(ratingMatch[1]) : 7.0;
  if (manga.rating > 10) manga.rating = parseFloat((manga.rating / 10).toFixed(1));

  // Genres
  const genreSection = html.match(/Genres?:([^]*?)(?:Author|Mangazines|$)/i);
  const genres = [];
  if (genreSection) {
    const genreLinks = [...genreSection[1].matchAll(/<a[^>]*href="\/genre\/([^"]+)"[^>]*>([^<]+)<\/a>/gi)];
    genreLinks.forEach(g => {
      const name = cleanupSlug(g[2] || g[1]);
      if (name && !genres.includes(name)) genres.push(name);
    });
  }
  manga.genres = genres.length > 0 ? genres : ['Manga'];

  // Description
  const descMatch = html.match(/<p[^>]*class="[^"]*(?:description|synopsis|summary)[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
    || html.match(/<div[^>]*class="[^"]*(?:description|synopsis|summary)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  manga.description = descMatch
    ? cleanupSlug(descMatch[1].replace(/<[^>]+>/g, '')).substring(0, 500)
    : `Leia ${manga.title} online no MangaSurge.`;

  // Chapters
  const chapterLinks = [...html.matchAll(/<a[^>]*href="(\/read\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set();
  chapterLinks.forEach(ch => {
    const href = ch[1];
    if (!href.includes('/chapter-')) return;

    const chMatch = href.match(/chapter-([\d.]+)/);
    if (!chMatch) return;

    const chNum = chMatch[1];
    if (seen.has(chNum)) return;
    seen.add(chNum);

    const titleContent = ch[2].replace(/<[^>]+>/g, '').trim();
    const dateMatch = titleContent.match(/:\s*(.+)$/);
    const title = dateMatch ? cleanupSlug(titleContent.split(':')[0]) : `Capítulo ${chNum}`;
    const dateStr = dateMatch ? dateMatch[1].trim() : '';

    // Parse date
    let date = '2024-01-01';
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        date = d.toISOString().split('T')[0];
      }
    }

    manga.chapters.push({
      id: `${id.split('.')[0]}-${chNum}`,
      number: `Capítulo ${chNum}`,
      title: cleanupSlug(title).substring(0, 100) || `Capítulo ${chNum}`,
      pages: 20,
      date,
      link: `${BASE}${href}`
    });
  });

  // Sort chapters by number
  manga.chapters.sort((a, b) => {
    const na = parseFloat(a.number.replace('Capítulo ', ''));
    const nb = parseFloat(b.number.replace('Capítulo ', ''));
    return na - nb;
  });

  return manga;
}

function toDataJs(mangas) {
  const json = JSON.stringify(mangas, null, 2);
  return `const MANGA_DATA = ${json};\n\nconst ALL_GENRES = [...new Set(MANGA_DATA.flatMap(m => m.genres))].sort();\n\nfunction getManga(id) { return MANGA_DATA.find(m => m.id === id); }\n\nfunction searchManga(query) {\n  const q = query.toLowerCase().trim();\n  if (!q) return [];\n  return MANGA_DATA.filter(m =>\n    m.title.toLowerCase().includes(q) ||\n    m.altTitle.toLowerCase().includes(q) ||\n    m.author.toLowerCase().includes(q) ||\n    m.genres.some(g => g.toLowerCase().includes(q))\n  );\n}\n\nfunction filterManga({ genres = [], status = "", sort = "recent", query = "", yearMin = "", yearMax = "", ratingMin = "" } = {}) {\n  let results = MANGA_DATA;\n  if (query) results = results.filter(m => searchManga(query).includes(m));\n  if (genres.length > 0) results = results.filter(m => genres.every(g => m.genres.includes(g)));\n  if (status) results = results.filter(m => m.status === status);\n  if (yearMin) results = results.filter(m => m.year >= parseInt(yearMin));\n  if (yearMax) results = results.filter(m => m.year <= parseInt(yearMax));\n  if (ratingMin) results = results.filter(m => m.rating >= parseFloat(ratingMin));\n  switch (sort) {\n    case "title": results.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')); break;\n    case "rating": results.sort((a, b) => b.rating - a.rating); break;\n    case "year": results.sort((a, b) => b.year - a.year); break;\n    case "oldest": results.sort((a, b) => a.year - b.year); break;\n    case "recent": default:\n      results.sort((a, b) => { const aL = Math.max(...a.chapters.map(c => new Date(c.date))); const bL = Math.max(...b.chapters.map(c => new Date(c.date))); return bL - aL; }); break;\n  }\n  return results;\n}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes('--all');
  const specificIds = args.find(a => a.startsWith('--ids='));
  const limit = isAll ? Infinity : 20;

  console.log('🔍 MangaFire Scraper');
  console.log('══════════════════════');

  let allIds = [];

  if (specificIds) {
    const ids = specificIds.replace('--ids=', '').split(',');
    allIds = ids.map(id => ({ id, url: `${BASE}/manga/${id}` }));
    console.log(`📋 Extraindo ${ids.length} mangá(s) específico(s)...`);
  } else {
    console.log('📦 Lendo sitemaps...');
    for (let i = 1; i <= TOTAL_SITEMAPS; i++) {
      try {
        console.log(`   Sitemap ${i}/${TOTAL_SITEMAPS}...`);
        const xml = await fetch(`${SITEMAP_BASE}${i}.xml`);
        const ids = extractMangaIds(xml);
        allIds.push(...ids);
        if (!isAll && allIds.length >= limit) {
          allIds = allIds.slice(0, limit);
          break;
        }
      } catch (e) {
        console.log(`   ⚠️ Erro no sitemap ${i}: ${e.message}`);
      }
    }

    if (isAll) {
      console.log(`📦 Total de ${allIds.length} mangás encontrados nos sitemaps`);
    } else {
      console.log(`📦 Modo teste: processando ${limit} mangás`);
      console.log('   Use --all para processar TODOS ou --ids=id1,id2 para específicos');
    }
  }

  const mangas = [];
  let count = 0;

  for (const entry of allIds) {
    count++;
    if (count > limit && !isAll && !specificIds) break;

    try {
      process.stdout.write(`   [${count}/${Math.min(allIds.length, limit)}] ${entry.id}... `);
      const html = await fetch(entry.url);
      const manga = extractMangaPage(html, entry.id);

      if (manga.title && manga.title !== entry.id) {
        mangas.push(manga);
        console.log(`✅ ${manga.title} (${manga.chapters.length} caps)`);
      } else {
        console.log('⚠️ Título não encontrado, pulando');
      }
    } catch (e) {
      console.log(`❌ Erro: ${e.message}`);
    }

    // Delay to avoid rate limiting
    await new Promise(r => setTimeout(r, isAll ? 200 : 100));
  }

  if (mangas.length === 0) {
    console.log('\n❌ Nenhum mangá extraído.');
    return;
  }

  const output = toDataJs(mangas);
  fs.writeFileSync(OUTPUT, output, 'utf8');
  console.log(`\n✅ ${mangas.length} mangás salvos em ${OUTPUT}`);
}

main().catch(console.error);
