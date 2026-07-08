const https = require('https');

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'MangaBankaiBot/1.0 (noreply@mangabankai.com)'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(new Error("Failed to parse JSON: " + e.message));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    const query = encodeURIComponent('Bleach');
    const searchUrl = `https://api.mangadex.org/manga?title=${query}&includes[]=cover_art&includes[]=author&includes[]=artist`;
    console.log("Searching MangaDex for Bleach...");
    const result = await getJson(searchUrl);
    
    if (!result.data || result.data.length === 0) {
      console.log("No manga found for Bleach.");
      return;
    }
    
    console.log(`Found ${result.data.length} results:`);
    for (const m of result.data) {
      const title = m.attributes.title.en || Object.values(m.attributes.title)[0];
      console.log(`- Title: ${title}`);
      console.log(`  ID: ${m.id}`);
      console.log(`  Status: ${m.attributes.status}`);
      console.log(`  Year: ${m.attributes.year}`);
      
      // Let's count PT-BR chapters for this ID
      console.log("  Fetching PT-BR chapter count...");
      const feedUrl = `https://api.mangadex.org/manga/${m.id}/feed?translatedLanguage[]=pt-br&limit=1`;
      const feed = await getJson(feedUrl);
      console.log(`  PT-BR Chapters: ${feed.total || 0}`);
    }
  } catch(e) {
    console.error(e);
  }
}

main();
