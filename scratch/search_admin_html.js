const fs = require('fs');
const path = require('path');

const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

console.log("=== MangaLivre mentions in admin.html ===");
findMatches(adminHtml, /mangalivre/gi);

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
