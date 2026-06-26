// build-sitemap.cjs — gera sitemap.xml na raiz com a home, catálogo e cada mangá.
// Ajuda o Google a descobrir e indexar todas as páginas. Rode após atualizar data.js.
// Uso:  node build-sitemap.cjs   (ou via npm run build)

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SITE_URL || 'https://mangabankai.vercel.app';
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const SITEMAP_PATH = path.join(__dirname, 'sitemap.xml');

// Parser string-aware: ignora [ e ] dentro de strings JSON (ex: título "Chii-chan ]")
function bounds(content) {
  const marker = content.indexOf('MANGA_DATA = [');
  if (marker < 0) throw new Error('MANGA_DATA não encontrado em data.js');
  const startIdx = content.indexOf('[', marker);
  let depth = 0, inStr = false, esc = false, endIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    const c = content[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
    }
  }
  if (endIdx < 0) throw new Error('Array MANGA_DATA não fechado — data.js corrompido.');
  return { startIdx, endIdx };
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildSitemap() {
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(content);
  const arr = JSON.parse(content.substring(startIdx, endIdx));
  const today = new Date().toISOString().slice(0, 10);

  const urls = [];
  // Páginas estáticas principais
  urls.push({ loc: BASE_URL + '/', priority: '1.0', changefreq: 'daily' });
  urls.push({ loc: BASE_URL + '/catalog.html', priority: '0.9', changefreq: 'daily' });

  // Uma URL por mangá (pula os ocultos marcados no próprio data)
  for (const m of arr) {
    if (!m || !m.id || m.hidden) continue;
    urls.push({
      loc: BASE_URL + '/manga.html?id=' + encodeURIComponent(m.id),
      priority: '0.7',
      changefreq: 'weekly'
    });
  }

  const body = urls.map(u =>
    `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
  return { count: urls.length };
}

module.exports = { buildSitemap };

if (require.main === module) {
  const r = buildSitemap();
  console.log(`✅ sitemap.xml gerado: ${r.count} URLs`);
}
