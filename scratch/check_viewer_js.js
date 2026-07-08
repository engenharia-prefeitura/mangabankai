const https = require('https');

const url = 'https://mangadash.net/static/js/front/chapter_viewer.js';

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    console.log("Length:", data.length);
    console.log("First 2000 chars:");
    console.log(data.substring(0, 2000));
  });
}).on('error', (err) => {
  console.error("Error:", err.message);
});
