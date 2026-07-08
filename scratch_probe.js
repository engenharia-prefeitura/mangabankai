const https = require('https');
const fs = require('fs');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching manga listing page /manga/...');
  const resCatalog = await get('https://mangalivre.blog/manga/');
  console.log('Catalog Status:', resCatalog.status);
  fs.writeFileSync('catalog_manga.html', resCatalog.body);
  console.log('Saved catalog_manga.html');
  
  console.log('\nFetching manga page /manga/one-punch-man/...');
  const resManga = await get('https://mangalivre.blog/manga/one-punch-man/');
  console.log('Manga Page Status:', resManga.status);
  fs.writeFileSync('manga_one_punch_man.html', resManga.body);
  console.log('Saved manga_one_punch_man.html');
}

main().catch(console.error);
