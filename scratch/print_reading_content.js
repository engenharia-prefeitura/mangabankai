const https = require('https');
const fs = require('fs');
const path = require('path');

function getUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mugiwarasoficial.com/'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/');
  
  const startIdx = html.indexOf('class="reading-content"');
  if (startIdx >= 0) {
    // Find matching ending div or a large chunk
    const content = html.substring(startIdx - 100, startIdx + 30000);
    fs.writeFileSync(path.join(__dirname, 'reading_content.html'), content, 'utf8');
    console.log("Saved reading_content.html");
  } else {
    console.log("reading-content class not found in raw html!");
  }
}

main();
