const https = require('https');

function checkImage(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    }, (res) => {
      resolve(res.statusCode);
    }).on('error', () => resolve(500));
  });
}

async function main() {
  const base = 'https://cdn.mugiverso.com/mugiwarasoficial/manga_69a172f301d66/1af714ebd64d06586d4802af475c3efa/';
  console.log(`Checking sequential images in folder: ${base}...`);
  
  for (let i = 1; i <= 10; i++) {
    const filename = String(i).padStart(2, '0') + '.webp';
    const url = `${base}${filename}`;
    const status = await checkImage(url);
    console.log(`- ${filename}: status ${status}`);
  }
}

main();
