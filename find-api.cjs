// find-api.cjs - Find the API endpoint used by LeituraManga to load all chapters
const https = require('https');
const http = require('http');

const BASE_URL = 'https://leituramanga.net';

function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://leituramanga.net'
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetch(next, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    client.get && undefined; // satisfy linter
  }).catch(e => ({ status: 0, body: e.message, headers: {} }));
}

async function tryEndpoint(url) {
  process.stdout.write(`Testing: ${url} ... `);
  const res = await fetch(url);
  if (res.status === 200) {
    console.log(`✅ ${res.status} (${res.body.length} bytes)`);
    console.log('  Content-Type:', res.headers['content-type']);
    console.log('  Preview:', res.body.substring(0, 300));
    return true;
  } else {
    console.log(`❌ ${res.status}`);
    return false;
  }
}

async function main() {
  const slug = 'magic-emperor';
  const mangaId = '680b9c8694036afb098c9452'; // from RSC _id field (may vary)

  // Common Next.js/REST API patterns
  const endpoints = [
    `${BASE_URL}/api/chapters/${slug}`,
    `${BASE_URL}/api/manga/${slug}/chapters`,
    `${BASE_URL}/api/manga/${slug}`,
    `${BASE_URL}/api/${slug}/chapters`,
    `${BASE_URL}/manga/${slug}/chapters`,
    `${BASE_URL}/api/v1/manga/${slug}/chapters`,
    `${BASE_URL}/api/v1/manga/${slug}`,
  ];

  for (const ep of endpoints) {
    await tryEndpoint(ep);
    await new Promise(r => setTimeout(r, 500));
  }

  // Also try fetching the manga page with RSC header (Next.js RSC fetch pattern)
  console.log('\nTrying RSC fetch pattern...');
  await tryEndpoint(`${BASE_URL}/manga/${slug}?_rsc=1`);

  // Try _next/data pattern
  const htmlRes = await fetch(`${BASE_URL}/manga/${slug}`);
  const buildIdMatch = htmlRes.body.match(/"buildId"\s*:\s*"([^"]+)"/);
  if (buildIdMatch) {
    const buildId = buildIdMatch[1];
    console.log('Build ID:', buildId);
    await tryEndpoint(`${BASE_URL}/_next/data/${buildId}/manga/${slug}.json`);
  }
}

main().catch(console.error);
