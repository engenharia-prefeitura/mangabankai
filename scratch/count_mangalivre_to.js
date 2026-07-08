const fs = require('fs');
const path = require('path');

const DATA_JS_PATH = path.join(__dirname, '..', 'js', 'data.js');

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
  const raw = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(raw);
  const list = JSON.parse(raw.substring(startIdx, endIdx));
  
  const mlTo = list.filter(m => m.source === 'mangalivre-to');
  const mlBlog = list.filter(m => m.source === 'mangalivre' || m.source === 'mangalivre-blog');
  
  console.log("Total mangas in database:", list.length);
  console.log("Sourced from mangalivre-to:", mlTo.length);
  console.log("Sourced from mangalivre (blog):", mlBlog.length);
  
  if (mlTo.length > 0) {
    console.log("First 5 mangalivre-to titles:", mlTo.slice(0, 5).map(m => `${m.title} (ID: ${m.id}, Slug: ${m.slug})`));
  }
}

main();
