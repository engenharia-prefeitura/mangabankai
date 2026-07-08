// build-home.cjs — gera js/home.json com a RECÊNCIA real de cada mangá
// (último capítulo + data), lendo os arquivos de capítulos. Usado pela home
// para a fileira "Atualizados recentemente" e para mostrar "Cap X • há Yh".
// Uso: node build-home.cjs  (ou chamado automaticamente após salvar data.js)

const fs = require('fs');
const path = require('path');

const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, 'js', 'chapters');
const HOME_JSON_PATH = path.join(__dirname, 'js', 'home.json');
const RECENT_LIMIT = 60;

function findArrayEnd(content, si) {
  let depth = 0, inStr = false, esc = false;
  for (let i = si; i < content.length; i++) {
    const c = content[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) return i + 1; }
    }
  }
  return -1;
}

function mangaIds() {
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const marker = content.indexOf('MANGA_DATA = [');
  const si = content.indexOf('[', marker);
  const ei = findArrayEnd(content, si);
  if (ei < 0) throw new Error('data.js corrompido: array não fechado');
  return JSON.parse(content.substring(si, ei)).map(m => m.id);
}

// Último capítulo (maior número) e a data mais recente de um mangá.
function latestOf(id) {
  const p = path.join(CHAPTERS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  let obj;
  try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
  let bestNum = -Infinity, bestDate = 0;
  for (const lang of Object.keys(obj)) {
    const arr = obj[lang];
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      const n = parseFloat(c.number);
      if (!isNaN(n) && n > bestNum) bestNum = n;
      const t = c.date ? Date.parse(c.date) : NaN;
      if (!isNaN(t) && t > bestDate) bestDate = t;
    }
  }
  if (bestNum === -Infinity) return null;
  return { ch: bestNum, date: bestDate || null };
}

function buildHome() {
  const ids = mangaIds();
  const updated = {};       // id -> { ch, date(ms|null) }
  const dated = [];         // [{ id, ch, date }] só com data válida
  for (const id of ids) {
    const info = latestOf(id);
    if (!info) continue;
    updated[id] = { ch: info.ch, date: info.date };
    if (info.date) dated.push({ id, ch: info.ch, date: info.date });
  }
  dated.sort((a, b) => b.date - a.date);
  const recent = dated.slice(0, RECENT_LIMIT);
  const out = { generatedAt: Date.now(), recent, updated };
  fs.writeFileSync(HOME_JSON_PATH, JSON.stringify(out), 'utf8');
  return { mangas: ids.length, comData: dated.length, recent: recent.length, bytes: fs.statSync(HOME_JSON_PATH).size };
}

module.exports = { buildHome };

if (require.main === module) {
  const r = buildHome();
  console.log(`✅ home.json: ${r.recent} recentes, ${r.comData}/${r.mangas} com data (${(r.bytes/1024).toFixed(0)} KB)`);
}
