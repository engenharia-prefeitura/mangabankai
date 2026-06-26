// inspect-author.cjs - Check what author/description fields exist in RSC
const https = require('https');
const http = require('http');

const BASE_URL = 'https://leituramanga.net';
const slug = process.argv[2] || 'a-ascensao-da-cobra-imortal';

function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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
  const html = await fetch(url);
  const rsc = extractRscPayload(html);

  // Check author-related keys
  const keys = ['author', 'autor', 'artist', 'artista', 'description', 'synopsis', 'summary'];
  for (const key of keys) {
    const rx = new RegExp(`"${key}"\\s*:\\s*"([^"]{1,200})"`, 'i');
    const m = rsc.match(rx);
    if (m) console.log(`"${key}": ${m[1]}`);
    else console.log(`"${key}": NOT FOUND`);
  }

  // Also check meta description from HTML
  const metaDesc = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  console.log('\nmeta description:', metaDesc ? metaDesc[1] : 'NOT FOUND');
  
  // Look for "authors" array
  const authorsBlock = rsc.match(/"authors"\s*:\s*\[([^\]]*)\]/);
  if (authorsBlock) console.log('\nauthors block:', authorsBlock[0].substring(0, 300));
  
  // Look for any field containing typical author indicators
  const authorCtx = rsc.match(/"(name|title)"\s*:\s*"[^"]{3,50}"[^}]{0,200}"(author|artist|creator)/i);
  if (authorCtx) console.log('\nauthor ctx:', authorCtx[0]);
}

main().catch(console.error);
