// check-chapters.cjs - Check how many chapters are in the RSC for a manga with many chapters
const https = require('https');
const http = require('http');

const BASE_URL = 'https://leituramanga.net';
const slug = process.argv[2] || 'magic-emperor';

function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetch(next, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractRsc(html) {
  const matches = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) || [];
  return matches.map(m => {
    const c = m.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/);
    return c ? c[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t') : '';
  }).join('');
}

async function main() {
  console.log(`Checking: ${BASE_URL}/manga/${slug}`);
  const html = await fetch(`${BASE_URL}/manga/${slug}`);
  const rsc = extractRsc(html);

  // Method 1: chapter links in RSC
  const chRegex = new RegExp(`/manga/${slug}/chapter/([^"\\s]+)`, 'g');
  const chMatches = rsc.match(chRegex) || [];
  const chNums = [...new Set(chMatches)].map(m => m.split('/chapter/')[1]);
  console.log(`\nMethod 1 (RSC chapter links): ${chNums.length} chapters`);
  console.log('Sample:', chNums.slice(0, 5), '...', chNums.slice(-5));

  // Method 2: look for chapters array in RSC JSON
  const chaptersArrayMatch = rsc.match(/"chapters"\s*:\s*\[(\{[^\]]*)\]/);
  if (chaptersArrayMatch) {
    const nums = chaptersArrayMatch[1].match(/"number"\s*:\s*([\d.]+)/g) || [];
    console.log(`\nMethod 2 (RSC chapters array): ${nums.length} chapters`);
  } else {
    console.log('\nMethod 2: No "chapters" array found in RSC');
  }

  // Method 3: look for chapter numbers in RSC
  const allChapterRefs = rsc.match(/chapter\/(\d+(?:\.\d+)?)/g) || [];
  const uniqueNums = [...new Set(allChapterRefs.map(r => r.split('/')[1]))];
  console.log(`\nMethod 3 (all chapter refs): ${uniqueNums.length} unique numbers`);
  console.log('Sample:', uniqueNums.slice(0, 10));

  // Check if there's an API endpoint
  console.log('\nChecking for API patterns in HTML...');
  const apiPaths = (html.match(/\/api\/[^"'\s]+/g) || []).slice(0, 10);
  console.log('API paths found:', apiPaths);
  
  // Look for _next/data
  const nextData = html.match(/__NEXT_DATA__[^>]*>({[^<]+})/);
  if (nextData) {
    console.log('\n__NEXT_DATA__ found:', nextData[1].substring(0, 200));
  }
}

main().catch(console.error);
