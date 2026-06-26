// check-catalog-size.cjs
const https = require('https');
const http = require('http');
const fs = require('fs');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await fetch('https://leituramanga.net/manga?page=1');
  
  // Count slugs on page 1
  const slugs = [...new Set(
    (html.match(/\/manga\/([^/"]+)/g) || [])
      .map(m => m.split('/manga/')[1])
      .filter(s => s && !s.includes('/') && !s.includes('?'))
  )];
  console.log('Slugs on page 1:', slugs.length);

  // Find max page number
  const pageNums = (html.match(/page=(\d+)/g) || [])
    .map(p => parseInt(p.split('=')[1]))
    .filter(n => !isNaN(n));
  const maxPage = pageNums.length > 0 ? Math.max(...pageNums) : 1;
  console.log('Max page seen in pagination:', maxPage);
  console.log('Estimated total mangas (approx):', slugs.length * maxPage);

  // Current stats from data.js
  const src = fs.readFileSync('./js/data.js', 'utf8');
  const ptCount = (src.match(/"hasPt":\s*true/g) || []).length;
  const enCount = (src.match(/"hasEn":\s*true/g) || []).length;
  const total = (src.match(/"id":/g) || []).length;
  console.log('\nCurrent data.js:');
  console.log('  Total mangas:', total);
  console.log('  EN mangas:', enCount);
  console.log('  PT mangas:', ptCount);
}

main().catch(console.error);
