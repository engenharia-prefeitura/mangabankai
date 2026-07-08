// inspect-rsc.cjs - Dump the RSC payload for a manga to understand the genre structure
const https = require('https');
const http = require('http');

const BASE_URL = 'https://leituramanga.net';
const slug = process.argv[2] || 'a-ascensao-da-cobra-imortal';

function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetch(next, redirects + 1).then(resolve).catch(reject);
      }
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

async function main() {
  const url = `${BASE_URL}/manga/${slug}`;
  console.log(`Fetching: ${url}\n`);
  const html = await fetch(url);
  const rsc = extractRscPayload(html);

  // Find all occurrences of "genres" in the RSC
  const genreRegex = /"genres"\s*:\s*\[([^\]]*)\]/g;
  let match;
  let idx = 0;
  while ((match = genreRegex.exec(rsc)) !== null) {
    idx++;
    console.log(`\n=== genres occurrence #${idx} (at char ${match.index}) ===`);
    // Show 200 chars of context before
    const ctxBefore = rsc.substring(Math.max(0, match.index - 300), match.index);
    console.log('CONTEXT BEFORE:', ctxBefore.substring(ctxBefore.length - 200));
    console.log('VALUE:', match[0].substring(0, 300));
  }

  // Also find manga-specific genre links
  console.log('\n\n=== All /genre/ links in RSC ===');
  const gLinks = [...rsc.matchAll(/\/genre\/([^"'\s>\\]+)/g)];
  const uniqueGenres = [...new Set(gLinks.map(g => decodeURIComponent(g[1]).replace(/-/g, ' ')))];
  console.log('Unique genre links found:', uniqueGenres.length);
  console.log(JSON.stringify(uniqueGenres.slice(0, 30)));
  
  // Look for the manga title nearby genres
  console.log('\n\n=== Title context ===');
  const titleIdx = rsc.indexOf(slug);
  if (titleIdx >= 0) {
    console.log('Slug found at:', titleIdx);
    console.log(rsc.substring(titleIdx, titleIdx + 500));
  }
}

main().catch(console.error);
