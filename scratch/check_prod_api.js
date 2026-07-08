const https = require('https');

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

async function main() {
  const url = 'https://mangabankai.vercel.app/resolve-chapter?lang=pt&mangaId=mugiwaras-blue-lock&slug=blue-lock&chNum=344';
  console.log("Querying production API:", url);
  const res = await getUrl(url);
  console.log("Production API status:", res.status);
  console.log("Production API headers:", res.headers);
  console.log("Production API response data:", res.data);
}

main();
