const fs = require('fs');
const { createPool } = require('@vercel/postgres');
const path = require('path');

async function syncHidden() {
  if (!process.env.DATABASE_URL) {
    console.log('Sem DATABASE_URL. Pulando sync de hidden_manga.');
    return;
  }
  
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query('SELECT manga_id FROM hidden_manga');
    const hiddenSet = new Set(rows.map(r => String(r.manga_id)));
    
    const dataJsPath = path.join(__dirname, 'js', 'data.js');
    if (!fs.existsSync(dataJsPath)) {
      console.log('data.js não encontrado.');
      return;
    }
    
    let dataJs = fs.readFileSync(dataJsPath, 'utf8');
    const marker = dataJs.indexOf('MANGA_DATA = [');
    if (marker < 0) throw new Error('MANGA_DATA não encontrado');
    const arrayStart = dataJs.indexOf('[', marker);
    let depth = 0, inStr = false, esc = false, arrayEnd = arrayStart;
    
    for (let i = arrayStart; i < dataJs.length; i++) {
      const c = dataJs[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === '[') depth++;
        else if (c === ']') { depth--; if (depth === 0) { arrayEnd = i + 1; break; } }
      }
    }
    
    const mangaList = JSON.parse(dataJs.substring(arrayStart, arrayEnd));
    let modified = 0;
    
    for (const m of mangaList) {
      const isHidden = hiddenSet.has(String(m.id));
      if (isHidden && !m.hidden) {
        m.hidden = true;
        modified++;
      } else if (!isHidden && m.hidden) {
        delete m.hidden;
        modified++;
      }
    }
    
    if (modified > 0) {
      const newJson = JSON.stringify(mangaList, null, 2);
      fs.writeFileSync(dataJsPath, dataJs.substring(0, arrayStart) + newJson + dataJs.substring(arrayEnd));
      console.log(`✅ sync-hidden: ${modified} mangás atualizados.`);
    } else {
      console.log('✅ sync-hidden: Nenhuma alteração necessária.');
    }
  } catch (err) {
    console.error('❌ Erro no sync-hidden:', err);
  } finally {
    await pool.end();
  }
}

syncHidden();
