const https = require('https');

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mugiwarasoficial.com/'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => resolve(''));
  });
}

async function main() {
  const p100 = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/100/');
  const match = p100.match(/redenovax\.com\/jump\/[^?]+\?a=([^&"]+)/);
  if (match) {
    console.log("Page 100 image link:", decodeURIComponent(match[1]));
  } else {
    console.log("No image link found on page 100!");
  }
}

main();
