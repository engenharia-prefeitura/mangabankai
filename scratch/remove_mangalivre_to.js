const fs = require('fs');
const path = require('path');

const DATA_JS_PATH = path.join(__dirname, '..', 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, '..', 'js', 'chapters');

function bounds(content) {
  const marker = content.indexOf('MANGA_DATA = [');
  if (marker < 0) throw new Error('MANGA_DATA não encontrado');
  const startIdx = content.indexOf('[', marker);
  let depth = 0, inStr = false, esc = false, endIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    const c = content[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } } }
  }
  if (endIdx < 0) throw new Error('array não fechado');
  return { startIdx, endIdx };
}

function main() {
  console.log("Starting cleanup of mangalivre-to...");
  
  const raw = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(raw);
  const list = JSON.parse(raw.substring(startIdx, endIdx));
  
  // Filter out mangalivre-to
  const filteredList = list.filter(m => m.source !== 'mangalivre-to');
  const removedCount = list.length - filteredList.length;
  console.log(`Removing ${removedCount} mangas from database...`);
  
  // Find and delete chapter files
  let deletedFilesCount = 0;
  const files = fs.readdirSync(CHAPTERS_DIR);
  for (const file of files) {
    if (file.startsWith('mangalivre-to-') && file.endsWith('.json')) {
      const filePath = path.join(CHAPTERS_DIR, file);
      try {
        fs.unlinkSync(filePath);
        deletedFilesCount++;
      } catch (e) {
        console.error(`Failed to delete ${file}: ${e.message}`);
      }
    }
  }
  console.log(`Deleted ${deletedFilesCount} chapter files.`);
  
  // Save updated data.js
  fs.writeFileSync(DATA_JS_PATH, raw.substring(0, startIdx) + JSON.stringify(filteredList, null, 2) + raw.substring(endIdx), 'utf8');
  console.log("Saved updated data.js successfully!");
  
  // Trigger builds
  console.log("Rebuilding site components...");
  try {
    require('../build-lite.cjs').buildLite();
    console.log("buildLite completed.");
  } catch (e) {
    console.error("buildLite failed:", e.message);
  }
  
  try {
    require('../build-home.cjs').buildHome();
    console.log("buildHome completed.");
  } catch (e) {
    console.error("buildHome failed:", e.message);
  }
  
  console.log("Cleanup completed successfully!");
}

main();
