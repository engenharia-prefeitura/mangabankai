const https = require('https');

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  console.log("Fetching API routes index...");
  const data = await getUrl('https://mugiwarasoficial.com/wp-json/');
  if (!data) {
    console.log("Failed to fetch.");
    return;
  }
  
  console.log("Registered Namespaces:");
  console.log(data.namespaces);
  
  console.log("\nSearching for manga/chapter routes...");
  const routes = Object.keys(data.routes || {});
  const matchingRoutes = routes.filter(r => r.includes('manga') || r.includes('chapter') || r.includes('wp-manga'));
  console.log(`Found ${matchingRoutes.length} matching routes:`);
  console.log(matchingRoutes);
}

main();
