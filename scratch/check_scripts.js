const https = require('https');

const url = 'https://mangadash.net/capitulo/166-the-reincarnated-king-of-fists/99';

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Status Code:", res.statusCode);
    
    // Extract scripts
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let count = 0;
    while ((match = scriptRegex.exec(data)) !== null) {
      count++;
      console.log(`\n--- SCRIPT #${count} ---`);
      const srcMatch = match[0].match(/src="([^"]+)"/);
      if (srcMatch) {
        console.log("Src:", srcMatch[1]);
      } else {
        const content = match[1].trim();
        console.log("Inline Content (first 500 chars):", content.substring(0, 500));
      }
    }
  });
}).on('error', (err) => {
  console.error("Error:", err.message);
});
