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
  
  // Find all img tags
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  console.log(`Total image tags on page: ${imgTags.length}`);
  
  // Look for reading-content or wp-manga or entry-content class
  const contentMatch = html.match(/class="[^"]*reading-content[^"]*"[^>]*>/i) || html.match(/class="[^"]*page-break[^"]*"[^>]*>/i);
  console.log("Found reading-content or page-break:", !!contentMatch);
  
  // Print first 10 images on the page
  console.log("First 10 images:");
  imgTags.slice(0, 10).forEach((t, i) => console.log(`${i+1}: ${t}`));
  
  // Look for any inline scripts that define page list
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  console.log(`Total scripts: ${scripts.length}`);
  scripts.forEach((s, idx) => {
    if (s.includes('chapter_preloaded_images') || s.includes('images') || s.includes('wp-manga')) {
      console.log(`Script #${idx+1} has keywords:`, s.substring(0, 500));
    }
  });
}

main();
