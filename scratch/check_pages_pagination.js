const https = require('https');

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
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    }).on('error', reject);
  });
}

async function main() {
  try {
    const urls = [
      'https://mugiwarasoficial.com/manga/bleach-manga/686/2/',
      'https://mugiwarasoficial.com/manga/bleach-manga/686/?page=2',
      'https://mugiwarasoficial.com/manga/bleach-manga/686/?paged=2',
      'https://mugiwarasoficial.com/manga/bleach-manga/686/?style=paged'
    ];
    
    for (const url of urls) {
      console.log(`Checking URL: ${url} ...`);
      const res = await getUrl(url);
      console.log(`Status: ${res.status}`);
      if (res.status === 200) {
        // Search for redenovax.com in the HTML
        const hasRedenovax = res.data.includes('redenovax.com');
        console.log(`  Contains redenovax: ${hasRedenovax}`);
        if (hasRedenovax) {
          // print the matches
          const match = res.data.match(/a=https:[^"]+/);
          console.log(`  First image link match: ${match ? match[0] : 'None'}`);
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
}

main();
