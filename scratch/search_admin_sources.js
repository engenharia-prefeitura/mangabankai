const fs = require('fs');
const path = require('path');

const adminServer = fs.readFileSync(path.join(__dirname, '..', 'admin-server.cjs'), 'utf8');

console.log("=== Tankouhentai / Tiamanhwa in admin-server.cjs ===");
findMatches(adminServer, /tankouhentai|tiamanhwa/gi);

function findMatches(text, regex) {
  const lines = text.split('\n');
  let matchCount = 0;
  lines.forEach((line, idx) => {
    if (regex.test(line)) {
      matchCount++;
      console.log(`Line ${idx + 1}: ${line.trim().substring(0, 120)}`);
    }
  });
  console.log(`Total: ${matchCount}`);
}
