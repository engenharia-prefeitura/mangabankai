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
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function main() {
  try {
    // 1. Get manga detail page
    const manga = await getUrl('https://mangadash.net/manga/341-a-ultima-passagem');
    console.log("Manga Page status:", manga.status);
    
    // Find a chapter URL
    const chUrlMatch = manga.data.match(/href="([^"]+\/capitulo\/[^"]+)"/);
    if (!chUrlMatch) {
      console.log("No chapter link found in page!");
      return;
    }
    const chUrl = chUrlMatch[1];
    console.log("Found chapter URL:", chUrl);
    
    // 2. Get chapter page html
    const chPage = await getUrl(chUrl);
    console.log("Chapter page status:", chPage.status);
    
    // Search for the JSON config containing pdfUrl
    const jsonMatch = chPage.data.match(/\{\s*"pdfUrl"[\s\S]*?\}/);
    if (jsonMatch) {
      console.log("JSON config found:\n", jsonMatch[0]);
    } else {
      console.log("No JSON config containing pdfUrl found. Let's check for standard image tags.");
      const imgTags = [...chPage.data.matchAll(/<img\b[^>]*>/gi)];
      console.log(`Found ${imgTags.length} image tags on page`);
    }
  } catch (e) {
    console.error(e);
  }
}

main();
