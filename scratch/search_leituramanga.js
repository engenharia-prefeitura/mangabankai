const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Referer': 'https://leituramanga.net/'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function main() {
  try {
    // LeituraManga uses next.js / Next.js RSC.
    // Let's try searching via URL search or checking a direct URL like /manga/bleach
    console.log("Checking direct URL: https://leituramanga.net/manga/bleach ...");
    const directRes = await fetchUrl('https://leituramanga.net/manga/bleach');
    console.log("Direct URL status:", directRes.status);
    if (directRes.status === 200) {
      console.log("Found Bleach page! Checking chapter list...");
      // Let's check how many chapters are listed in the HTML
      const chapters = [...directRes.data.matchAll(/chapter\/([\d.]+)/g)].map(m => m[1]);
      const uniqueChapters = [...new Set(chapters)].sort((a,b)=>parseFloat(a)-parseFloat(b));
      console.log(`Found ${uniqueChapters.length} unique chapters.`);
      console.log("First 5 chapters:", uniqueChapters.slice(0, 5));
      console.log("Last 5 chapters:", uniqueChapters.slice(-5));
    }
  } catch (e) {
    console.error(e);
  }
}

main();
