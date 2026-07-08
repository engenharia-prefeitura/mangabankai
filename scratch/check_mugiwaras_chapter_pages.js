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
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

async function main() {
  const html = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/1/');
  
  // Count redenovax links
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map(m => m[1]);
  const imageLinks = hrefs.filter(h => h.includes('redenovax.com') && h.includes('?a='));
  
  console.log(`Total redenovax image links in Chapter 1: ${imageLinks.length}`);
  if (imageLinks.length > 0) {
    console.log("First 3 image links:");
    imageLinks.slice(0, 3).forEach((link, i) => {
      const u = new URL(link);
      console.log(`${i+1}: ${u.searchParams.get('a')}`);
    });
  }
}

main();
