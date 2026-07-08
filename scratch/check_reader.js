const fs = require('fs');
const path = require('path');

const readerHtml = fs.readFileSync(path.join(__dirname, '..', 'reader.html'), 'utf8');

// Find all script tags
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
while ((match = scriptRegex.exec(readerHtml)) !== null) {
  count++;
  console.log(`\n--- SCRIPT #${count} ---`);
  const srcMatch = match[0].match(/src="([^"]+)"/);
  if (srcMatch) {
    console.log("Src:", srcMatch[1]);
  } else {
    console.log("Inline Content (first 500 chars):", match[1].trim().substring(0, 500));
  }
}
