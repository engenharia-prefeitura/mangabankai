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
    console.log("=== Fetch/Ajax/Axios/API Mentions ===");
    findMatches(data, /fetch|ajax|axios|api|\$\.get|\$\.post|url/gi);
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
      if (matchCount <= 40) {
        console.log(`Line ${idx + 1}: ${line.trim().substring(0, 120)}`);
      }
    }
  });
  console.log(`Total matches: ${matchCount}`);
}
