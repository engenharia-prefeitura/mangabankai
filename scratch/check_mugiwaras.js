const https = require('https');

function getUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log("Checking home page of mugiwarasoficial.com...");
    const home = await getUrl('https://mugiwarasoficial.com/');
    console.log("Home Status:", home.status);
    
    // Check if it mentions "wp-content" or "madara"
    const hasWp = home.data.includes('wp-content');
    const hasMadara = home.data.includes('madara') || home.data.includes('wp-manga');
    console.log("Has wp-content:", hasWp);
    console.log("Has madara/wp-manga:", hasMadara);
    
    console.log("Checking manga list or sitemap...");
    const sitemap = await getUrl('https://mugiwarasoficial.com/wp-manga-sitemap.xml');
    console.log("Manga Sitemap Status:", sitemap.status);
    if (sitemap.status === 200) {
      console.log("Sitemap length:", sitemap.data.length);
      console.log(sitemap.data.substring(0, 500));
    }
  } catch (e) {
    console.error("Error:", e.message);
  }
}

main();
