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
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

async function main() {
  const html = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/2/');
  
  // Extract nav links
  const navMatches = [...html.matchAll(/class="btn[^"]*"[^>]*href="([^"]+)"/gi)].map(m => m[1]);
  console.log("Navigation buttons found on page 2:", navMatches);
  
  // Print anything related to page selection/pagination dropdown
  const selectMatches = [...html.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/gi)].map(m => m[1]);
  console.log("Number of select elements:", selectMatches.length);
  selectMatches.forEach((s, idx) => {
    if (s.includes('option')) {
      console.log(`Select #${idx+1} options (first 500 chars):`, s.trim().substring(0, 500));
    }
  });
}

main();
