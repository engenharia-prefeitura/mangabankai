// build-sitemap.cjs — gera um SITEMAP INDEX (sitemap.xml) + sitemaps filhos
// (sitemap-1.xml, sitemap-2.xml, …) com até URLS_PER_FILE URLs cada.
//
// Estrutura recomendada pelo Google para muitos URLs: cada filho é pequeno
// (~200KB) e o índice é trivial de parsear, evitando "couldn't read" por tamanho.
// Um stylesheet XSL (sitemap.xsl) deixa o XML legível no navegador.
//
// Roda no build (ver vercel.json e npm run build). Os filhos sitemap-N.xml são
// regenerados a cada deploy (ignorados no git); o índice sitemap.xml é commitado.
// Uso:  node build-sitemap.cjs

const fs = require('fs');
const path = require('path');
// Lógica compartilhada: decide quais mangás têm página SSG / URL limpa.
const { isEligible, cleanPath } = require('./build-ssg.cjs');

const BASE_URL = (process.env.SITE_URL || 'https://mangabankai.vercel.app').replace(/\/$/, '');
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const ROOT = __dirname;
const URLS_PER_FILE = 1000;       // URLs por sitemap filho (limite oficial: 50.000)
const STYLESHEET = '/sitemap.xsl';

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

  // Monta a lista completa de URLs
  const urls = [];
  urls.push({ loc: BASE_URL + '/', priority: '1.0', changefreq: 'daily' });
  urls.push({ loc: BASE_URL + '/catalog.html', priority: '0.9', changefreq: 'daily' });
  // Uma URL por mangá (pula ocultos). Elegíveis ao SSG → URL limpa /manga/<id>/;
  // o restante mantém manga.html?id=... do SPA.
  for (const m of arr) {
    if (!m || !m.id || m.hidden) continue;
    const loc = isEligible(m)
      ? BASE_URL + cleanPath(m)
      : BASE_URL + '/manga.html?id=' + encodeURIComponent(m.id);
    urls.push({ loc, priority: '0.7', changefreq: 'weekly' });
  }

  // Remove filhos antigos antes de regenerar (evita sobras quando o nº de lotes diminui)
  for (const f of fs.readdirSync(ROOT)) {
    if (/^sitemap-\d+\.xml$/.test(f)) fs.unlinkSync(path.join(ROOT, f));
  }

  // Divide em lotes e gera os sitemaps filhos
  const chunks = [];
  for (let i = 0; i < urls.length; i += URLS_PER_FILE) chunks.push(urls.slice(i, i + URLS_PER_FILE));

  chunks.forEach((chunk, idx) => {
    const body = chunk.map(u =>
      `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    ).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="${STYLESHEET}"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
    fs.writeFileSync(path.join(ROOT, `sitemap-${idx + 1}.xml`), xml, 'utf8');
  });

  // Gera o índice (sitemap.xml) apontando para cada filho
  const idxBody = chunks.map((_, idx) =>
    `  <sitemap>\n    <loc>${xmlEscape(BASE_URL + '/sitemap-' + (idx + 1) + '.xml')}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`
  ).join('\n');
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="${STYLESHEET}"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${idxBody}\n</sitemapindex>\n`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), indexXml, 'utf8');

  return { total: urls.length, files: chunks.length };
}

module.exports = { buildSitemap };

if (require.main === module) {
  const r = buildSitemap();
  console.log(`✅ sitemap.xml (índice) + ${r.files} filhos gerados: ${r.total} URLs no total`);
}
