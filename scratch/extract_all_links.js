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
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await getUrl('https://mugiwarasoficial.com/manga/bleach-manga/686/');
  
  const startIdx = html.indexOf('class="reading-content"');
  if (startIdx >= 0) {
    const block = html.substring(startIdx, html.indexOf('</div>', startIdx + 5000) + 100000); // get a big chunk
    
    // Find all links in this block
    const hrefs = [...block.matchAll(/href="([^"]+)"/gi)].map(m => m[1]);
    console.log(`Total links in reading-content: ${hrefs.length}`);
    
    const imageLinkParams = hrefs.filter(h => h.includes('redenovax.com') && h.includes('?a='));
    console.log(`Links containing redenovax and ?a=: ${imageLinkParams.length}`);
    
    if (imageLinkParams.length > 0) {
      console.log("First 5 extracted real images:");
      imageLinkParams.slice(0, 5).forEach((link, i) => {
        const u = new URL(link);
        const realImg = u.searchParams.get('a');
        console.log(`${i+1}: ${realImg}`);
      });
    }
  } else {
    console.log("reading-content class not found in raw html!");
  }
}

main();
