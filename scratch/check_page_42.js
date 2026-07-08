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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data, finalUrl: res.headers.location || url }));
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

async function main() {
  const p1 = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/');
  const p2 = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/2/');
  const p42 = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/42/');
  
  console.log("Page 1 status:", p1.status, "Redirect location:", p1.headers.location);
  console.log("Page 2 status:", p2.status, "Redirect location:", p2.headers.location);
  console.log("Page 42 status:", p42.status, "Redirect location:", p42.headers.location);
  
  // Extract redenovax links
  const extractImg = (html) => {
    const m = html.match(/redenovax\.com\/jump\/[^?]+\?a=([^&"]+)/);
    return m ? decodeURIComponent(m[1]) : 'None';
  };
  
  console.log("Page 1 image:", extractImg(p1.data));
  console.log("Page 2 image:", extractImg(p2.data));
  console.log("Page 42 image:", extractImg(p42.data));
}

main();
