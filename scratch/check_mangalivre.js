const https = require('https');

function checkDomain(domain) {
  return new Promise((resolve) => {
    const req = https.get(`https://${domain}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    }, (res) => {
      resolve({ domain, status: res.statusCode, headers: res.headers });
    });
    req.on('error', (err) => {
      resolve({ domain, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ domain, error: 'Timeout' });
    });
  });
}

async function main() {
  const results = await Promise.all([
    checkDomain('mangalivre.to'),
    checkDomain('mangalivre.blog')
  ]);
  console.log(JSON.stringify(results, null, 2));
}

main();
