const https = require('https');

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://mugiwarasoficial.com/'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

async function main() {
  const html = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/');
  
  const startIdx = html.indexOf('class="reading-content"');
  if (startIdx >= 0) {
    const snippet = html.substring(startIdx, startIdx + 8000);
    console.log("=== reading-content HTML (first 8000 chars) ===");
    console.log(snippet);
  } else {
    console.log("reading-content class not found in HTML!");
  }
}

main();
