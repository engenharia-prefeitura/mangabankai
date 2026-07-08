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
  const data = await getUrl('https://mugiwarasoficial.com/wp-json/');
  if (!data || !data.routes) {
    console.log("Failed to fetch.");
    return;
  }
  
  const routes = Object.keys(data.routes);
  console.log("Total routes found:", routes.length);
  
  const wpV2Routes = routes.filter(r => r.startsWith('/wp/v2/'));
  console.log("\nSome wp/v2 routes:");
  console.log(wpV2Routes.slice(0, 30));
}

main();
