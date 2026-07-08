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
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', (err) => resolve({ status: 500, error: err.message }));
  });
}

async function main() {
  const indexRes = await getUrl('https://mugiwarasoficial.com/sitemap_index.xml');
  console.log("sitemap_index.xml status:", indexRes.status);
  if (indexRes.status === 200) {
    console.log("Index content (first 2000 chars):");
    console.log(indexRes.data.substring(0, 2000));
  }
  
  const wpMangaSitemap = await getUrl('https://mugiwarasoficial.com/wp-manga-sitemap.xml');
  console.log("\nwp-manga-sitemap.xml status:", wpMangaSitemap.status);
  if (wpMangaSitemap.status === 200) {
    const urls = [...wpMangaSitemap.data.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    console.log("Total URLs in wp-manga-sitemap.xml:", urls.length);
    console.log("First 5 URLs:");
    console.log(urls.slice(0, 5));
  }
}

main();
