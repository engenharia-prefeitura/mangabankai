// hentai20-scraper.cjs — scraper standalone para Hentai20.io (+18 EN)
// Layout Themesia (JSON de imagens ts_reader e links de capítulo simplificados).
// Roda no workflow do GitHub Actions e localmente.
//
// Uso:
//   node hentai20-scraper.cjs
//   node hentai20-scraper.cjs --all

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const BASE_H20 = 'https://hentai20.io';
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, 'js', 'chapters');

const FULL = process.argv.includes('--all');
const MAX_PAGES = FULL ? 9999 : 3;
const MAX_MANGAS = parseInt(process.env.H20_MAX || (FULL ? '99999' : '25'), 10); // mangás por execução (evita estourar tempo do CI)

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'");
}

function fetchH20Url(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Referer': BASE_H20 + '/'
      },
      timeout: 30000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchH20Url(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 403) return reject(new Error('CF_BLOCKED:403'));
      if (res.statusCode === 404) return reject(new Error('NOT_FOUND:404'));
      if (res.statusCode === 429 || res.statusCode === 503) return reject(new Error(`RATE_LIMIT:${res.statusCode}`));
      
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          let text;
          if (enc === 'gzip') text = zlib.gunzipSync(buf).toString('utf8');
          else if (enc === 'deflate') text = zlib.inflateSync(buf).toString('utf8');
          else if (enc === 'br') text = zlib.brotliDecompressSync(buf).toString('utf8');
          else text = buf.toString('utf8');
          resolve(text);
        } catch (e) { resolve(buf.toString('utf8')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseH20ListPage(html) {
  const slugs = new Set();
  const SKIP = new Set(['page', 'list-mode', 'manga-genre', 'feed', 'wp-content', 'wp-includes', 'wp-admin']);
  for (const m of html.matchAll(/href="https?:\/\/hentai20\.io\/manga\/([^/"#]+)\/"/gi)) {
    const s = m[1];
    if (s && s.length > 2 && !SKIP.has(s) && !s.startsWith('wp-')) slugs.add(s);
  }
  const nums = [...html.matchAll(/\/manga\/page\/(\d+)\//gi)].map(m => parseInt(m[1]));
  const totalPages = nums.length > 0 ? Math.max(...nums) : 1;
  return { slugs: [...slugs], totalPages };
}

function parseH20Post(html, mSlug) {
  let title = '';
  const ogT = html.match(/<meta[^>]+property="og:title"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
  if (ogT) {
    title = decodeEntities(ogT[1])
      .replace(/\s*:\s*Read\s+Webtoon.*$/i, '')
      .replace(/\s*[-–|]\s*(hentai20\.io|Read.*(Online|Webtoon)).*$/i, '').trim();
  }
  if (!title) {
    const h1 = html.match(/<h1[^>]*class="entry-title"[^>]*>\s*([^<]+)/i);
    if (h1) title = decodeEntities(h1[1].trim());
  }

  // Capa: o tema Themesia NÃO expõe og:image — a capa está em div.thumb > img.
  let cover = '';
  const thumb = html.match(/class="thumb"[^>]*>\s*<img[^>]+src="([^"]+)"/i)
    || html.match(/<img[^>]+class="[^"]*wp-post-image[^"]*"[^>]+src="([^"]+)"/i)
    || html.match(/<meta[^>]+property="og:image"\s+content="([^"]+)"/i);
  if (thumb) cover = thumb[1];

  let description = '';
  const ogD = html.match(/<meta[^>]+property="og:description"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+name="description"\s+content="([^"]+)"/i);
  if (ogD) description = decodeEntities(ogD[1].trim());

  // Gêneros: SÓ os do mangá (container .seriestugenre/.mgen) — evita o lixo do
  // menu global de gêneros (que enchia a lista com 40+ itens).
  let genres = [];
  const mg = html.match(/class="seriestugenre"[^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/class="mgen"[^>]*>([\s\S]*?)<\/span>/i);
  if (mg) {
    genres = [...new Set(
      [...mg[1].matchAll(/>([^<]+)<\/a>/g)].map(m => decodeEntities(m[1].trim())).filter(g => g.length > 1 && g.length < 50)
    )];
  }
  if (genres.length === 0) genres.push('Hentai');
  if (!genres.some(g => g.toLowerCase().includes('hentai'))) genres.unshift('Hentai');
  if (!genres.some(g => g.toLowerCase().includes('adult'))) genres.push('Adult');
  genres = genres.slice(0, 12);

  const stM = html.match(/Status\s*<\/b>\s*:\s*([^<]+)/i) || html.match(/(Ongoing|Completed|On-Going|Complete)/i);
  const status = stM && !stM[1].toLowerCase().includes('complet') ? 'ongoing' : 'completed';

  const chapMap = new Map();
  const chapRefs = [...html.matchAll(/<a[^>]+href=\"(https?:\/\/hentai20\.io\/([a-z0-9-]+)-chapter-([0-9.]+)\/?)\"[^>]*>([\s\S]*?)<\/a>/gi)];
  
  for (const m of chapRefs) {
    const url = m[1];
    const numStr = m[3];
    const rawText = m[4].replace(/<[^>]+>/g, '').replace(/Latest:\s*/i, '').trim();
    const num = parseFloat(numStr) || 1;
    
    if (!chapMap.has(num) || rawText.length > chapMap.get(num).title.length) {
      chapMap.set(num, {
        url,
        number: num,
        title: rawText || `Chapter ${numStr}`
      });
    }
  }

  const chapters = [...chapMap.values()].sort((a, b) => b.number - a.number);
  return { title, cover, description, genres, status, chapters };
}

async function fetchH20ChapterPages(chapterUrl) {
  try {
    const html = await fetchH20Url(chapterUrl);
    const readerM = html.match(/ts_reader\.run\(([\s\S]+?)\);/);
    if (readerM) {
      try {
        const data = JSON.parse(readerM[1]);
        if (data.sources && data.sources[0] && Array.isArray(data.sources[0].images)) {
          return data.sources[0].images.map(img => img.trim());
        }
      } catch (e) {
        console.error(`Erro ao fazer parse do ts_reader JSON:`, e.message);
      }
    }
    
    const pages = [];
    for (const m of html.matchAll(/<img[^>]+src="([^"]+img\.hentai1\.io[^"]+)"/gi)) {
      pages.push(m[1].trim());
    }
    return [...new Set(pages)];
  } catch (e) {
    console.error(`Erro ao buscar páginas do capítulo ${chapterUrl}:`, e.message);
    return [];
  }
}

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
  if (endIdx < 0) throw new Error('Array MANGA_DATA não fechado.');
  return { startIdx, endIdx };
}

let _rawData = '';
function loadMangaList() {
  _rawData = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(_rawData);
  return JSON.parse(_rawData.substring(startIdx, endIdx));
}

function saveMangaList(list) {
  const { startIdx, endIdx } = bounds(_rawData);
  fs.writeFileSync(DATA_JS_PATH, _rawData.substring(0, startIdx) + JSON.stringify(list, null, 2) + _rawData.substring(endIdx), 'utf8');
}

function loadChObj(id) {
  const p = path.join(CHAPTERS_DIR, id + '.json');
  if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {} }
  return { en: [] };
}

function saveChObj(id, obj) {
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(CHAPTERS_DIR, id + '.json'), JSON.stringify(obj, null, 2), 'utf8');
}

async function main() {
  console.log(`🤖 Iniciando Scraper Standalone Hentai20 (Modo: ${FULL ? 'Completo' : 'Incremental'})...`);
  
  let data;
  try {
    data = loadMangaList();
  } catch (e) {
    console.error(`Erro ao carregar data.js:`, e.message);
    return;
  }
  
  const byId = new Map(data.map(m => [m.id, m]));
  const allSlugs = new Set();
  
  try {
    const html1 = await fetchH20Url(`${BASE_H20}/manga/?m_orderby=latest`);
    const { slugs: s1, totalPages: tp } = parseH20ListPage(html1);
    s1.forEach(s => allSlugs.add(s));
    
    const pagesToScan = Math.min(tp, MAX_PAGES);
    console.log(`- Catálogo tem ${tp} páginas. Escaneando ${pagesToScan} páginas...`);
    
    for (let p = 2; p <= pagesToScan; p++) {
      try {
        const html = await fetchH20Url(`${BASE_H20}/manga/page/${p}/?m_orderby=latest`);
        const { slugs } = parseH20ListPage(html);
        slugs.forEach(s => allSlugs.add(s));
        console.log(`  Página ${p} escaneada: ${slugs.length} slugs.`);
        await sleep(400);
      } catch (e) {
        console.error(`⚠️ Erro na página ${p}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`💥 Falha crítica ao listar catálogo:`, e.message);
    return;
  }
  
  // Prioridade: REPROCESSA os hentai20 existentes (por id conhecido, conserta os
  // 49 quebrados mesmo fora da lista recente) e depois adiciona os novos da lista.
  // Pula slugs de outras fontes. Teto por execução p/ não estourar o tempo do CI.
  // Incremental: reprocessa só os QUEBRADOS (sem capa) — assim cada execução
  // avança nos defeituosos e não re-baixa os já consertados. Full: reprocessa todos.
  let existing = data.filter(m => m.source === 'hentai20');
  if (!FULL) existing = existing.filter(m => !m.cover);
  const existIds = existing.map(m => m.id);
  const newOnes = [...allSlugs].filter(s => !byId.has(s));
  const toProcess = [...new Set([...existIds, ...newOnes])].slice(0, MAX_MANGAS);
  console.log(`- ${existIds.length} hentai20 a reprocessar + ${newOnes.length} novos; processando ${toProcess.length} (teto ${MAX_MANGAS}).`);

  let newAdded = 0, updated = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const slug = toProcess[i];
    const existing = byId.get(slug);
    console.log(`- [${i+1}/${toProcess.length}] ${existing ? 'Reprocessando' : 'Novo'}: ${slug}...`);
    try {
      const html = await fetchH20Url(`${BASE_H20}/manga/${slug}/`);
      const { title, cover, description, genres, status, chapters } = parseH20Post(html, slug);
      if (!title || !chapters.length) {
        console.warn(`⚠️ Sem título/capítulos para ${slug}, pulando.`);
        continue;
      }

      const chapList = [];
      for (let j = 0; j < chapters.length; j++) {
        const ch = chapters[j];
        const pages = await fetchH20ChapterPages(ch.url);
        await sleep(350);
        if (!pages.length) continue;
        chapList.push({
          id: `${slug}-ch-${ch.number}`, number: ch.number, title: ch.title,
          date: new Date().toISOString(), pages, src: 'hentai20', chapterUrl: ch.url
        });
      }
      if (!chapList.length) { console.warn(`⚠️ ${slug}: nenhuma página, pulando.`); continue; }
      chapList.sort((a, b) => a.number - b.number);

      const mangaEntry = {
        id: slug, slug, title, altTitle: '',
        cover, banner: cover,
        author: 'Unknown', artist: 'Unknown',
        status, year: (existing && existing.year) || new Date().getFullYear(), rating: 0,
        genres, description, descriptionEn: description,
        chaptersCount: chapList.length,
        lang: 'en', hasPt: false, hasEn: true,
        source: 'hentai20'
      };

      saveChObj(slug, { en: chapList });
      if (existing) { Object.assign(existing, mangaEntry); updated++; console.log(`  ♻️ ${title} (${chapList.length} caps)`); }
      else { data.push(mangaEntry); byId.set(slug, mangaEntry); newAdded++; console.log(`  ✨ ${title} (${chapList.length} caps)`); }
      saveMangaList(data);
      await sleep(500);
    } catch (e) {
      console.error(`⚠️ Erro ao processar ${slug}:`, e.message);
    }
  }
  console.log(`\n✅ Hentai20: ${newAdded} novos, ${updated} reprocessados.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  fetchH20Url,
  parseH20ListPage,
  parseH20Post,
  fetchH20ChapterPages
};
