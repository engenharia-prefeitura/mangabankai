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
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await getUrl('https://mangadash.net/manga/341-a-ultima-passagem');
  console.log("HTML length:", html.length);
  const links = [...html.matchAll(/href="([^"]+)"/gi)].map(m => m[1]);
  const capituloLinks = links.filter(l => l.includes('capitulo'));
  console.log("Capitulo links found:", capituloLinks);
}

main();
