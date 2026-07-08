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
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', (err) => resolve({ status: 500, error: err.message }));
  });
}

async function main() {
  const target = 'https://mugiwarasoficial.com/manga/blue-lock/capitulo-344/';
  
  // Test AllOrigins proxy
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
  console.log("Checking AllOrigins proxy...");
  const res = await getUrl(proxyUrl);
  console.log("Status:", res.status);
  
  const match = res.data.match(/redenovax\.com\/jump\/[^?]+\?a=([^&"]+)/);
  if (match) {
    console.log("SUCCESS! Found redirect link:", match[0]);
  } else {
    console.log("Failed to find redirect link. Head of content:");
    console.log(res.data.substring(0, 500));
  }
}

main();
