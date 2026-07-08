const fs = require('fs');
const path = require('path');

const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

const lines = adminHtml.split('\n');
console.log("=== admin.html lines 1460 to 1510 ===");
for (let i = 1460; i <= 1510; i++) {
  if (lines[i - 1] !== undefined) {
    console.log(`${i}: ${lines[i - 1].trim()}`);
  }
}
