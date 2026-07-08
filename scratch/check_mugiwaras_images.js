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
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function main() {
  try {
    const chUrl = 'https://mugiwarasoficial.com/manga/bleach-manga/686/';
    console.log(`Checking chapter page: ${chUrl}...`);
    const chPage = await getUrl(chUrl);
    console.log("Chapter Page Status:", chPage.status);
    
    // Look for images in the HTML
    const imgs = [];
    const grab = (tag) => { const m = tag.match(/(?:data-src|data-lazy-src|src)="\s*([^"]+?)\s*"/i); if (m) imgs.push(m[1].trim()); };
    for (const m of chPage.data.matchAll(/<img[^>]*\bclass="[^"]*wp-manga-chapter-img[^"]*"[^>]*>/gi)) grab(m[0]);
    if (!imgs.length) for (const m of chPage.data.matchAll(/<img[^>]*\bid="image-\d+"[^>]*>/gi)) grab(m[0]);
    
    console.log(`Found ${imgs.length} chapter page images.`);
    if (imgs.length > 0) {
      console.log("First 3 image URLs:", imgs.slice(0, 3));
    }
  } catch (e) {
    console.error("Error:", e.message);
  }
}

main();
