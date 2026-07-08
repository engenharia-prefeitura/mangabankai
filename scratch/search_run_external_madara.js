const fs = require('fs');
const path = require('path');

const adminServer = fs.readFileSync(path.join(__dirname, '..', 'admin-server.cjs'), 'utf8');

const idx = adminServer.indexOf('function runExternalMadara');
if (idx >= 0) {
  console.log("=== runExternalMadara definition ===");
  console.log(adminServer.substring(idx, idx + 1500));
} else {
  console.log("runExternalMadara function not found!");
}
