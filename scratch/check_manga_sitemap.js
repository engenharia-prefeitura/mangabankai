const https = require('https');

const url = 'https://mangadash.net/sitemap-mangas.xml';

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    const urls = [...data.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    console.log("Total manga URLs in sitemap:", urls.length);
    console.log("First 5 manga URLs:", urls.slice(0, 5));
  });
}).on('error', (err) => {
  console.error("Error:", err.message);
});
