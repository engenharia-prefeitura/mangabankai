const https = require('https');

function checkPage(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mugiwarasoficial.com/'
      },
      timeout: 5000
    }, (res) => {
      resolve(res.statusCode);
    }).on('error', () => resolve(500));
  });
}

async function main() {
  const base = 'https://mugiwarasoficial.com/manga/bleach-manga/686/';
  console.log(`Checking sub-pages of ${base}...`);
  
  // Page 1 is the main URL. Let's test 2, 3, 4, ...
  let p = 2;
  while (true) {
    const url = `${base}${p}/`;
    const status = await checkPage(url);
    console.log(`Page ${p} status: ${status}`);
    if (status !== 200) {
      break;
    }
    p++;
    if (p > 50) break; // safety cap
  }
  console.log(`Finished. Total pages: ${p - 1}`);
}

main();
