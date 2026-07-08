const https = require('https');

function getUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function main() {
  try {
    const robots = await getUrl('https://mangadash.net/robots.txt');
    console.log("=== robots.txt ===");
    console.log(robots.data);
    
    const sitemap = await getUrl('https://mangadash.net/sitemap.xml');
    console.log("=== sitemap.xml ===");
    console.log("Status:", sitemap.status);
    console.log(sitemap.data.substring(0, 1000));
  } catch (e) {
    console.error(e);
  }
}

main();
