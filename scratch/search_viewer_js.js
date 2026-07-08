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
    // Search for keywords
    console.log("=== PDF Mentions ===");
    findMatches(data, /pdf/gi);
    
    console.log("\n=== Canvas Mentions ===");
    findMatches(data, /canvas/gi);
    
    console.log("\n=== Page/Image Mentions ===");
    findMatches(data, /image|img/gi);
  });
}).on('error', (err) => {
  console.error("Error:", err.message);
});

function findMatches(text, regex) {
  const lines = text.split('\n');
  let matchCount = 0;
  lines.forEach((line, idx) => {
    if (regex.test(line)) {
      matchCount++;
      if (matchCount <= 20) {
        console.log(`Line ${idx + 1}: ${line.trim().substring(0, 120)}`);
      }
    }
  });
  console.log(`Total matches: ${matchCount}`);
}
