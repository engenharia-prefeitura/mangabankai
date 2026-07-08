const fs = require('fs');
const path = require('path');

const adminServer = fs.readFileSync(path.join(__dirname, '..', 'admin-server.cjs'), 'utf8');

console.log("=== Mangalivre-to mentions in admin-server.cjs ===");
findMatches(adminServer, /mangalivre-to/gi);

console.log("\n=== Mangalivre mentions in admin-server.cjs ===");
findMatches(adminServer, /mangalivre/gi);

console.log("\n=== Mugiwaras mentions in admin-server.cjs ===");
findMatches(adminServer, /mugiwaras/gi);

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
