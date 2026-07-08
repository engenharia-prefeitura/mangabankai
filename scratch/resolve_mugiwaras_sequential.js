const https = require('https');

function checkImage(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function getChapterHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mugiwarasoficial.com/'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function resolveMugiwarasPages(chapterUrl) {
  console.time('Full Resolve');
  const html = await getChapterHtml(chapterUrl);
  const match = html.match(/redenovax\.com\/jump\/[^?]+\?a=([^&"]+)/);
  if (!match) {
    console.timeEnd('Full Resolve');
    return [];
  }
  
  const page1Url = decodeURIComponent(match[1]);
  // e.g. https://cdn.mugiverso.com/mugiwarasoficial/manga_69a172f301d66/e3b18179a41f377f3f01b87d328738fd/01.webp
  const lastSlash = page1Url.lastIndexOf('/');
  const baseFolder = page1Url.substring(0, lastSlash + 1);
  
  // Test up to 100 pages in parallel
  const pageChecks = [];
  for (let i = 1; i <= 100; i++) {
    const filename = String(i).padStart(2, '0') + '.webp';
    const url = `${baseFolder}${filename}`;
    pageChecks.push(checkImage(url).then(exists => exists ? url : null));
  }
  
  const results = await Promise.all(pageChecks);
  const pages = results.filter(Boolean);
  
  console.timeEnd('Full Resolve');
  return pages;
}

async function main() {
  const pages = await resolveMugiwarasPages('https://mugiwarasoficial.com/manga/bleach-manga/686/');
  console.log(`Resolved ${pages.length} pages.`);
  console.log("First 3:", pages.slice(0, 3));
  console.log("Last 3:", pages.slice(-3));
}

main();
