// mundohentai-scraper.cjs — scraper standalone para mundohentaioficial.com (+18 PT)
// Roda no workflow do GitHub Actions e localmente.
// Altera o comportamento anterior salvando as URLs estáticas das imagens diretamente
// no arquivo de capítulos para que a leitura funcione 100% online sem depender do painel.
//
// Uso:
//   node mundohentai-scraper.cjs
//   node mundohentai-scraper.cjs --all

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const { resolveCap } = require('./lib/scraper-config.cjs');

const BASE_MH = 'https://mundohentaioficial.com';
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, 'js', 'chapters');

const FULL = process.argv.includes('--all');
const MAX_PAGES = FULL ? 9999 : 3;
// Teto de obras NOVAS por execução (config/env). --all ignora.
const MAX_MANGAS = resolveCap({ key: 'mundohentai', envVar: 'MH_MAX', incrementalDefault: 10, fullDefault: 99999, full: FULL });

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

function fetchMhUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Referer': BASE_MH + '/'
      },
      timeout: 30000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchMhUrl(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 403) return reject(new Error('CF_BLOCKED:403'));
      if (res.statusCode === 404) return reject(new Error('NOT_FOUND:404'));
      if (res.statusCode === 429 || res.statusCode === 503)
        return reject(new Error(`RATE_LIMIT:${res.statusCode}`));
      
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseMhPost(html) {
  const idMatch = html.match(/data-id="(\d+)"/) || html.match(/download_manga\/(\d+)/) || html.match(/\?p=(\d+)/);
  const mhId = idMatch ? parseInt(idMatch[1]) : null;

  const pagesMatch = html.match(/<li><strong>P[aá]ginas?<\/strong>\s*(\d+)<\/li>/i);
  const pageCount = pagesMatch ? parseInt(pagesMatch[1]) : 0;

  const titleMatch = html.match(/<title>(?:\[[^\]]*\]\s*)?([^|<]+)/i);
  let title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';
  title = title.replace(/\s*[-–|]\s*(Mundo\s*Hentai[^|<]*|MundoHentai[^|<]*)$/i, '').trim();

  const coverMatch = html.match(/<meta[^>]+property="og:image"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
  const cover = coverMatch ? coverMatch[1] : '';

  const descMatch = html.match(/<meta[^>]+property="og:description"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i)
    || html.match(/<meta[^>]+name="description"\s+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i);
  const description = descMatch ? decodeEntities(descMatch[1].trim()) : '';

  const tagMatches = [...html.matchAll(/href="https?:\/\/mundohentaioficial\.com\/tag\/[^"]*"\s+rel="tag">([^<]+)<\/a>/g)];
  const tags = tagMatches.map(m => decodeEntities(m[1].trim()));

  const catMatches = [...html.matchAll(/href="https?:\/\/mundohentaioficial\.com\/category\/[^"]*"\s+title="([^"]+)"/g)];
  const categories = catMatches.map(m => decodeEntities(m[1].trim()));

  return { mhId, pageCount, title, cover, description, tags, categories };
}

function parseMhListPage(html) {
  const EXCLUDED = new Set([
    'category','tag','page','parodia','cor','personagens','parodias','tags',
    'cadastro','entrar','contato','download_manga','galeria','feed',
    'animes-hentai','manga-hentai','one-shot','hentai-sem-censura',
    'hentai-3d','comics','jav','doujinshi','hentai','netorare',
    'ahegao-hentai','milf','incesto','anal','super-hq','yaoi'
  ]);

  const slugs = new Set();
  for (const m of html.matchAll(/href="https?:\/\/mundohentaioficial\.com\/([\w-]+)\/(?:[^"#?]*)"/g)) {
    const slug = m[1];
    if (
      !EXCLUDED.has(slug) &&
      slug.length > 8 &&
      slug.includes('-') &&
      !slug.startsWith('wp-') &&
      !slug.startsWith('hentai-') &&
      !slug.startsWith('super-')
    ) {
      slugs.add(slug);
    }
  }

  const pageNums = [...html.matchAll(/\/page\/(\d+)\//g)].map(m => parseInt(m[1]));
  const totalPages = pageNums.length > 0 ? Math.max(...pageNums) : 1;

  return { slugs: [...slugs], totalPages };
}

async function fetchMhGalleryImage(mhId, imgNum) {
  try {
    const html = await fetchMhUrl(`${BASE_MH}/galeria?id=${mhId}&img=${imgNum}`);
    const patterns = [
      /<meta[^>]+property="og:image"\s+content="([^"]+)"/i,
      /<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i,
      /class="[^"]*(?:galeria|leitura|img-hentai|imagem-principal)[^"]*"[^>]*>[\s\S]{0,300}?<img[^>]+(?:data-src|src)="([^"]+)"/i,
      /<img[^>]+src="(https?:\/\/mundohentaioficial\.com\/wp-content\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i,
      /<img[^>]+src="(https?:\/\/[^"]*\/wp-content\/[^"]+\.(?:jpe?g|png|webp))"/i
    ];
    for (const p of patterns) {
      const mx = html.match(p);
      if (mx && mx[1] && !/logo|Logo|icon|banner|cropped/i.test(mx[1])) {
        return mx[1];
      }
    }
  } catch (e) {}
  return null;
}

async function fetchMhChapterPages(mhId, pageCount) {
  if (!mhId || !pageCount) return [];
  const indices = Array.from({ length: pageCount }, (_, i) => i + 1);
  const results = new Array(pageCount).fill(null);
  let nextIdx = 0;

  // 5 workers paralelos para não sobrecarregar
  await Promise.all(Array.from({ length: Math.min(5, pageCount) }, async () => {
    while (nextIdx < indices.length) {
      const idx = nextIdx++;
      try { results[idx] = await fetchMhGalleryImage(mhId, indices[idx]); } catch (e) {}
      await sleep(150);
    }
  }));

  return results.filter(Boolean);
}

// ---------- data.js helper functions ----------
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
  return { pt: [] };
}

function saveChObj(id, obj) {
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(CHAPTERS_DIR, id + '.json'), JSON.stringify(obj, null, 2), 'utf8');
}

async function main() {
  console.log(`🤖 Iniciando Scraper Standalone MundoHentai (Modo: ${FULL ? 'Completo' : 'Incremental'})...`);
  
  let data;
  try {
    data = loadMangaList();
  } catch (e) {
    console.error(`Erro ao carregar data.js:`, e.message);
    return;
  }
  
  // Limpar títulos existentes
  let titleFixed = 0;
  for (const m of data) {
    if (m.source === 'mundohentai' && m.title) {
      const cleaned = m.title.replace(/\s*[-–|]\s*(Mundo\s*Hentai[^|<]*|MundoHentai[^|<]*)$/i, '').trim();
      if (cleaned !== m.title) { m.title = cleaned; titleFixed++; }
    }
  }
  if (titleFixed > 0) {
    console.log(`- MundoHentai: ${titleFixed} títulos corrigidos.`);
    saveMangaList(data);
  }
  
  const existingSlugs = new Set(data.filter(m => m.source === 'mundohentai').map(m => m.id));
  const allSlugs = new Set();
  
  try {
    const html1 = await fetchMhUrl(BASE_MH + '/');
    const { slugs: slugsP1, totalPages: tp } = parseMhListPage(html1);
    slugsP1.forEach(s => allSlugs.add(s));
    
    const pagesToScan = Math.min(tp, MAX_PAGES);
    console.log(`- Catálogo tem ${tp} páginas. Escaneando ${pagesToScan} páginas...`);
    
    for (let p = 2; p <= pagesToScan; p++) {
      try {
        const html = await fetchMhUrl(`${BASE_MH}/page/${p}/`);
        const { slugs } = parseMhListPage(html);
        slugs.forEach(s => allSlugs.add(s));
        console.log(`  Página ${p} escaneada: ${slugs.length} slugs.`);
        await sleep(300);
      } catch (e) {
        console.error(`⚠️ Erro na página ${p}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`💥 Falha crítica ao listar catálogo:`, e.message);
    return;
  }
  
  let newSlugs = [...allSlugs].filter(s => !existingSlugs.has(s));
  console.log(`- Encontrados ${allSlugs.size} slugs totais, ${newSlugs.length} novos.`);
  // Teto de obras novas por execução (config/env). --all processa todos.
  if (!FULL && newSlugs.length > MAX_MANGAS) {
    console.log(`- Limitando a ${MAX_MANGAS} novas nesta execução (teto).`);
    newSlugs = newSlugs.slice(0, MAX_MANGAS);
  }

  let newAdded = 0;
  for (let i = 0; i < newSlugs.length; i++) {
    const slug = newSlugs[i];
    console.log(`- [${i+1}/${newSlugs.length}] Processando novo slug: ${slug}...`);
    try {
      const html = await fetchMhUrl(`${BASE_MH}/${slug}/`);
      const { mhId, pageCount, title, cover, description, tags, categories } = parseMhPost(html);
      
      if (!mhId || !title) {
        console.warn(`⚠️ Sem ID/Título para ${slug}, pulando.`);
        continue;
      }
      
      const genres = [];
      for (const cat of categories) {
        if (cat && !genres.includes(cat)) genres.push(cat);
      }
      if (!genres.some(g => g.toLowerCase().includes('hentai'))) genres.unshift('Hentai');
      for (const tag of tags) {
        if (tag && !genres.includes(tag)) genres.push(tag);
      }
      
      const mangaEntry = {
        id: slug, slug, title, altTitle: '',
        cover: cover || `${BASE_MH}/galeria?id=${mhId}&img=1`,
        banner: cover || `${BASE_MH}/galeria?id=${mhId}&img=1`,
        author: 'Desconhecido', artist: 'Desconhecido',
        status: 'completed', year: new Date().getFullYear(), rating: 0,
        genres, description, descriptionPt: description,
        chaptersCount: 1, lang: 'pt', hasPt: true, hasEn: false,
        mhId, pageCount, source: 'mundohentai'
      };
      
      console.log(`  -> Obtendo ${pageCount} páginas da galeria (mhId: ${mhId})...`);
      const pages = await fetchMhChapterPages(mhId, pageCount);
      
      saveChObj(slug, {
        pt: [{
          id: `${slug}-chapter-1`,
          number: 1,
          title: 'Completo',
          date: new Date().toISOString(),
          pages,
          src: 'mundohentai',
          mhId,
          pageCount
        }]
      });
      
      data.push(mangaEntry);
      newAdded++;
      console.log(`  ✨ Adicionado: ${title} (${pages.length}/${pageCount} páginas baixadas).`);
      
      saveMangaList(data);
      await sleep(500);
    } catch (e) {
      console.error(`⚠️ Erro ao processar ${slug}:`, e.message);
    }
  }
  
  console.log(`✅ Concluído! ${newAdded} novos mangás MundoHentai adicionados.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  fetchMhUrl,
  parseMhListPage,
  parseMhPost,
  fetchMhChapterPages
};
