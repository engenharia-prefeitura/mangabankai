const https = require('https');

function getUrlFollowRedirect(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mugiwarasoficial.com/'
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        console.log(`Redirecting to ${nextUrl}...`);
        return getUrlFollowRedirect(nextUrl).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, url }));
    }).on('error', reject);
  });
}

async function main() {
  try {
    console.log("Checking Bleach page on Mugiwaras (following redirects)...");
    const mangaPage = await getUrlFollowRedirect('https://mugiwarasoficial.com/manga/bleach/');
    console.log("Final URL:", mangaPage.url);
    console.log("Status:", mangaPage.status);
    
    // Look for wp-manga-chapter in the HTML or AJAX endpoint
    // Standard Madara endpoint to load chapters: /manga/<slug>/ajax/chapters/ (POST request usually)
    const matches = [...mangaPage.data.matchAll(/href="([^"]+?\/manga\/bleach\/[^"]+?)"/gi)].map(m => m[1]);
    console.log("Found direct chapter links in HTML:", matches.length);
    
    if (matches.length > 0) {
      console.log("First 5 links:", matches.slice(0, 5));
      const testChUrl = matches[0];
      console.log(`Checking chapter page: ${testChUrl}...`);
      const chPage = await getUrlFollowRedirect(testChUrl);
      console.log("Chapter Page Status:", chPage.status);
      
      const imgs = [];
      const grab = (tag) => { const m = tag.match(/(?:data-src|data-lazy-src|src)="\s*([^"]+?)\s*"/i); if (m) imgs.push(m[1].trim()); };
      for (const m of chPage.data.matchAll(/<img[^>]*\bclass="[^"]*wp-manga-chapter-img[^"]*"[^>]*>/gi)) grab(m[0]);
      if (!imgs.length) for (const m of chPage.data.matchAll(/<img[^>]*\bid="image-\d+"[^>]*>/gi)) grab(m[0]);
      
      console.log(`Found ${imgs.length} chapter page images!`);
      if (imgs.length > 0) {
        console.log("First 3 image URLs:", imgs.slice(0, 3));
      }
    } else {
      console.log("No direct chapter links found. Let's try standard WordPress Madara chapters AJAX endpoint...");
      // Let's extract the manga ID if available or just hit the ajax endpoint
      const idMatch = mangaPage.data.match(/data-id="(\d+)"/i) || mangaPage.data.match(/wp-manga-action-choose-style-[\s\S]*?value="(\d+)"/i);
      const postSlug = mangaPage.url.match(/manga\/([^/]+)/)[1];
      const ajaxUrl = `https://mugiwarasoficial.com/manga/${postSlug}/ajax/chapters/`;
      
      console.log(`Hitting AJAX endpoint: ${ajaxUrl} ...`);
      
      const postData = ''; // Madara ajax endpoint usually responds to empty POST or just GET/POST
      const req = https.request(ajaxUrl, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        let ajaxData = '';
        res.on('data', chunk => ajaxData += chunk);
        res.on('end', () => {
          console.log("AJAX Status:", res.statusCode);
          const chLinks = [...ajaxData.matchAll(/href="([^"]+?)"/gi)].map(m => m[1]);
          console.log(`Found ${chLinks.length} chapter links in AJAX response.`);
          if (chLinks.length > 0) {
            console.log("First 5 chapter links from AJAX:", chLinks.slice(0, 5));
          }
        });
      });
      req.on('error', (e) => console.error("AJAX Error:", e));
      req.write(postData);
      req.end();
    }
  } catch (e) {
    console.error("Error:", e.message);
  }
}

main();
