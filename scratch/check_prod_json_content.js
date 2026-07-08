const https = require('https');

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

async function main() {
  const url = 'https://mangabankai.vercel.app/js/chapters/mugiwaras-blue-lock.json';
  console.log("Fetching live JSON from:", url);
  const data = await getUrl(url);
  
  if (data.pt) {
    const ch344 = data.pt.find(c => String(c.number) === '344');
    console.log("Chapter 344 in live JSON:", ch344);
  } else {
    console.log("No 'pt' array found in live JSON:", Object.keys(data));
  }
}

main();
