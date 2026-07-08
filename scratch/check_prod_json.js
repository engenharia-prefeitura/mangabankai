const https = require('https');

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, length: data.length }));
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

async function main() {
  const res = await getUrl('https://mangabankai.vercel.app/js/chapters/mugiwaras-blue-lock.json');
  console.log("Production chapters file status:", res.status);
  console.log("Production chapters file headers:", res.headers);
  console.log("Production chapters file length:", res.length);
}

main();
