// fix-genres.cjs - Re-scrape genres for PT manga with bad genre data
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://leituramanga.net';
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const DELAY_MS = 1500;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetch(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractRscPayload(html) {
  const matches = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) || [];
  return matches.map(m => {
    const contentMatch = m.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/);
    return contentMatch ? contentMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t') : '';
  }).join('');
}

function loadAndParseMangaList() {
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const startMarker = 'let MANGA_DATA = ';
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) throw new Error('Cannot find MANGA_DATA');
  const arrStart = startIdx + startMarker.length;
  let depth = 0, endIdx = arrStart;
  for (let i = arrStart; i < content.length; i++) {
    if (content[i] === '[') depth++;
    if (content[i] === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }
  return {
    before: content.substring(0, arrStart),
    after: content.substring(endIdx),
    data: JSON.parse(content.substring(arrStart, endIdx))
  };
}

function saveMangaList(before, data, after) {
  fs.writeFileSync(DATA_JS_PATH, before + JSON.stringify(data, null, 2) + after, 'utf8');
}

async function scrapeGenres(slug) {
  const url = `${BASE_URL}/manga/${slug}`;
  try {
    const html = await fetch(url);
    const rsc = extractRscPayload(html);

    const genres = [];

    // The site's RSC returns genres as objects: {"isAdult":false,"_id":"...","name":"Ação","slug":"acao"}
    // Match the first "genres" occurrence (manga's own genres, not the sidebar list)
    const genresBlockMatch = rsc.match(/"genres"\s*:\s*\[(\{[^\]]*)\]/);
    if (genresBlockMatch) {
      const nameMatches = genresBlockMatch[1].match(/"name"\s*:\s*"([^"]+)"/g) || [];
      nameMatches.forEach(item => {
        const g = item.replace(/^"name"\s*:\s*"/, '').replace(/"$/, '').trim();
        if (g && !genres.includes(g)) genres.push(g);
      });
    }

    return genres.length > 0 ? genres : null;
  } catch (e) {
    console.error(`  ❌ Failed to scrape ${slug}: ${e.message}`);
    return null;
  }
}

async function main() {
  const { before, data, after } = loadAndParseMangaList();
  
  // Fix mangas that currently have ['Manhwa'] (were reset by previous run) OR still have many genres
  const badMangas = data.filter(m => 
    m.hasPt && (
      (Array.isArray(m.genres) && m.genres.length === 1 && m.genres[0] === 'Manhwa') ||
      (Array.isArray(m.genres) && m.genres.length > 10)
    )
  );
  console.log(`Found ${badMangas.length} PT manga(s) to fix.`);
  
  let fixedCount = 0;
  for (const manga of badMangas) {
    const slug = manga.id;
    process.stdout.write(`[${fixedCount + 1}/${badMangas.length}] ${manga.title}: `);
    
    await delay(DELAY_MS);
    const freshGenres = await scrapeGenres(slug);
    
    if (freshGenres && freshGenres.length > 0) {
      manga.genres = freshGenres;
      fixedCount++;
      console.log(`✅ ${JSON.stringify(freshGenres)}`);
    } else {
      console.log(`⚠️  Could not fetch genres, keeping as ['Manhwa'].`);
    }
    
    // Save progress every 5 mangas
    if ((fixedCount) % 5 === 0 && fixedCount > 0) {
      saveMangaList(before, data, after);
      console.log('  💾 Progress saved.');
    }
  }
  
  saveMangaList(before, data, after);
  console.log(`\n✅ Done! Fixed ${fixedCount}/${badMangas.length} manga(s).`);
}

main().catch(console.error);
