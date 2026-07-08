const https = require('https');

function getUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await getUrl('https://mangadash.net/capitulo/341-the-last-passage/87');
  
  // Look for any image tags in a container that might hold the reader pages
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  console.log(`Total image tags found: ${imgTags.length}`);
  
  // Show first 15 image tags
  console.log("First 15 image tags:");
  imgTags.slice(0, 15).forEach((tag, i) => console.log(`${i+1}: ${tag}`));

  // Check if there is another JSON or window object
  const windowMatches = [...html.matchAll(/window\.[a-zA-Z0-9_]+\s*=/g)].map(m => m[0]);
  console.log("Window assignments:", windowMatches);
}

main();
