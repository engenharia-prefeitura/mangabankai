// fix-authors.cjs - Re-scrape author and fix descriptions for PT mangas
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://leituramanga.net';
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const DELAY_MS = 1500;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetch(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetch(next, redirects + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractRscPayload(html) {
  const matches = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) || [];
  return matches.map(m => {
    const c = m.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/);
    return c ? c[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t') : '';
  }).join('');
}

function cleanDescription(raw) {
  return raw
    .replace(/,?\s*online\s+gr[aá]tis\s+no\s+Leitura\s+Manga\.?/gi, '.')
    .replace(/\s*Acompanhe\s+cap[ií]tulos\s+atualizados\s+com\s+imagens\s+em\s+alta\s+qualidade\.?/gi, '')
    .replace(/\s*no\s+Leitura\s+Manga\.?/gi, '.')
    .replace(/\s*Leitura\s+Manga\.?/gi, '.')
    .replace(/\.{2,}/g, '.')
    .trim();
}

function loadAndParse() {
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const marker = 'let MANGA_DATA = ';
  const startIdx = content.indexOf(marker);
  const arrStart = startIdx + marker.length;
  let depth = 0, endIdx = arrStart;
  for (let i = arrStart; i < content.length; i++) {
    if (content[i] === '[') depth++;
    if (content[i] === ']') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }
  return {
    before: content.substring(0, arrStart),
    after: content.substring(endIdx),
    data: JSON.parse(content.substring(arrStart, endIdx))
  };
}

function save(before, data, after) {
  fs.writeFileSync(DATA_JS_PATH, before + JSON.stringify(data, null, 2) + after, 'utf8');
}

async function scrapeAuthorAndDesc(slug) {
  const url = `${BASE_URL}/manga/${slug}`;
  try {
    const html = await fetch(url);
    const rsc = extractRscPayload(html);

    // Author from RSC authors array
    let author = null;
    const authorsBlock = rsc.match(/"authors"\s*:\s*\[(\{[^\]]*)\]/);
    if (authorsBlock) {
      const authorName = authorsBlock[1].match(/"name"\s*:\s*"([^"]+)"/);
      if (authorName) author = authorName[1].trim();
    }

    // Description from meta tag, then clean
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    const rawDesc = descMatch ? descMatch[1].trim() : null;
    const description = rawDesc ? cleanDescription(rawDesc) : null;

    return { author, description };
  } catch (e) {
    console.error(`  ❌ ${e.message}`);
    return { author: null, description: null };
  }
}

async function main() {
  const { before, data, after } = loadAndParse();

  // Fix all PT mangas: those with unknown author OR descriptions with "Leitura Manga"
  const toFix = data.filter(m => m.hasPt && (
    !m.author || m.author === 'Desconhecido' ||
    (m.description && m.description.includes('Leitura Manga')) ||
    (m.descriptionPt && m.descriptionPt.includes('Leitura Manga'))
  ));

  console.log(`Found ${toFix.length} PT manga(s) to update (author/description).`);

  let fixed = 0;
  for (const manga of toFix) {
    process.stdout.write(`[${fixed + 1}/${toFix.length}] ${manga.title}: `);
    await delay(DELAY_MS);
    const { author, description } = await scrapeAuthorAndDesc(manga.id);

    const changes = [];
    if (author && author !== 'Desconhecido' && (!manga.author || manga.author === 'Desconhecido')) {
      manga.author = author;
      manga.artist = author;
      changes.push(`author="${author}"`);
    }
    if (description) {
      if (manga.hasPt) {
        manga.descriptionPt = description;
        changes.push('descriptionPt cleaned');
      }
      if (!manga.description || manga.description.includes('Leitura Manga')) {
        manga.description = description;
        changes.push('description cleaned');
      }
    }

    fixed++;
    console.log(changes.length > 0 ? `✅ ${changes.join(', ')}` : '⚠️ no changes');

    if (fixed % 5 === 0) { save(before, data, after); console.log('  💾 Saved.'); }
  }

  save(before, data, after);
  console.log(`\n✅ Done! Updated ${fixed} manga(s).`);
}

main().catch(console.error);
