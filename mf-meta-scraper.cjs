const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'https://ww2.mangafreak.me';
const DELAY = 200;
const CONCURRENCY = 5;
const RESUME_FILE = path.join(__dirname, 'js', 'mf-meta-progress.json');
const OUTPUT_FILE = path.join(__dirname, 'js', 'mf-meta-data.json');
const LIST_FILE = path.join(__dirname, 'js', 'mf-manga-list.json');

const mangaList = require(LIST_FILE);

function fetch(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        res.resume(); // descarta o corpo para liberar o socket, senão o processo nunca encerra
        fetch(next, redirects + 1).then(resolve).catch(reject);
        return;
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Timeout: ${url}`)));
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMeta(html, slug) {
  var meta = { description: '', genres: [], author: '', artist: '', year: '', altTitle: '' };
  
  // Description - find the <p> inside manga_series_description
  var descMatch = html.match(/class="manga_series_description"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i);
  if (descMatch) meta.description = descMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
  
  // Genres - find /Genre/ links
  var genreLinks = [...new Set([...html.matchAll(/href="\/Genre\/([^"]+)"/g)].map(m => m[1]).filter(g => g !== 'All'))];
  meta.genres = genreLinks;
  
  // Author & Artist (value is in the same div: <div>Written By: Oda, Eiichiro</div>)
  var authorMatch = html.match(/Written By:\s*([^<]+)<\/div>/i);
  if (authorMatch) meta.author = authorMatch[1].trim();
  
  var artistMatch = html.match(/Illustrated By:\s*([^<]+)<\/div>/i);
  if (artistMatch) meta.artist = artistMatch[1].trim();
  
  // Year
  var yearMatch = html.match(/Year Published:\s*(\d{4})/i);
  if (yearMatch) meta.year = yearMatch[1];
  
  // Alternative title
  var altMatch = html.match(/Alternative Title:\s*([^<]+)<\/div>/i);
  if (altMatch) meta.altTitle = altMatch[1].trim();
  
  // Status (in case our listing data is wrong)
  var statusMatch = html.match(/This is\s+([A-Z-]+)\s+series/i);
  if (statusMatch) {
    var s = statusMatch[1].toUpperCase();
    meta.status = s === 'ON-GOING' || s === 'ONGOING' ? 'ongoing' : 'completed';
  }
  
  return meta;
}

let processed = new Set();
let metaData = {};

if (fs.existsSync(RESUME_FILE)) {
  const saved = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
  processed = new Set(saved.processed || []);
  if (fs.existsSync(OUTPUT_FILE)) {
    metaData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
  }
  console.log('Resuming: ' + processed.size + ' already processed');
}

function saveProgress() {
  fs.writeFileSync(RESUME_FILE, JSON.stringify({ processed: [...processed] }), 'utf8');
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(metaData), 'utf8');
}

async function processManga(manga) {
  if (processed.has(manga.slug)) return;
  
  try {
    const html = await fetch(BASE + '/Manga/' + manga.slug);
    const meta = extractMeta(html, manga.slug);
    metaData[manga.slug] = meta;
    processed.add(manga.slug);
    var pct = ((processed.size / mangaList.length) * 100).toFixed(1);
    process.stdout.write('\r' + pct + '% - ' + manga.slug + ': ' + meta.genres.length + ' genres     ');
  } catch (err) {
    console.log('\n' + manga.slug + ': ERROR ' + err.message);
    processed.add(manga.slug);
  }
  
  if (processed.size % 50 === 0) saveProgress();
}

async function main() {
  console.log('=== Scraping metadata for ' + mangaList.length + ' manga ===');
  var toProcess = mangaList.filter(function(m) { return !processed.has(m.slug); });
  console.log('Pending: ' + toProcess.length);
  
  for (var i = 0; i < toProcess.length; i += CONCURRENCY) {
    var batch = toProcess.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(function(m) { return processManga(m).then(function() { return delay(DELAY); }); }));
  }
  
  saveProgress();
  
  console.log('\nDone! ' + processed.size + '/' + mangaList.length);
  var withDesc = Object.values(metaData).filter(function(m) { return m.description.length > 0; }).length;
  var withGenres = Object.values(metaData).filter(function(m) { return m.genres.length > 0; }).length;
  console.log('With description: ' + withDesc);
  console.log('With genres: ' + withGenres);
  console.log('Output: ' + OUTPUT_FILE);
}

// exit explícito: garante que nenhum socket esquecido segure o processo aberto
main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
