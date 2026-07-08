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
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const match = data.match(/redenovax\.com\/jump\/[^?]+\?a=([^&"]+)/);
        if (match) {
          resolve(decodeURIComponent(match[1]));
        } else {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  const chapterUrl = 'https://mugiwarasoficial.com/manga/bleach-manga/686/';
  console.time('Resolve Chapter 686');
  
  // Create 50 page URLs (pages 1 to 50)
  const promises = [];
  promises.push(getUrl(chapterUrl)); // Page 1
  for (let p = 2; p <= 50; p++) {
    promises.push(getUrl(`${chapterUrl}${p}/`));
  }
  
  const results = await Promise.all(promises);
  const images = results.filter(Boolean);
  
  console.timeEnd('Resolve Chapter 686');
  console.log(`Resolved ${images.length} pages.`);
  console.log("Image URLs:", images);
}

main();
