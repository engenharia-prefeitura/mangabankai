const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_PT = 'https://leituramanga.net';
const CDN_PT  = 'https://cdn.leituramanga.net/';
const BASE_EN = 'https://ww2.mangafreak.me';
const API_ML  = 'https://mangalivre.blog/wp-json/wp/v2';

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 20000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrl(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) return reject(new Error('NOT_FOUND:404'));
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractRsc(html) {
  const matches = html.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g) || [];
  return matches.map(m => {
    const c = m.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/);
    return c ? c[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t') : '';
  }).join('');
}

async function fetchPtChapterPages(slug, chNum) {
  const html = await fetchUrl(`${BASE_PT}/manga/${slug}/chapter/${chNum}`);
  const rsc  = extractRsc(html);
  const imagesM = rsc.match(/"images"\s*:\s*\[([\s\S]*?)\]/);
  if (!imagesM) return [];
  const pages = [];
  let m;
  const urlR = /"url"\s*:\s*"([^"]+)"/g;
  while ((m = urlR.exec(imagesM[1])) !== null) pages.push(CDN_PT + m[1]);
  return pages;
}

async function fetchMdxChapterPages(chapterId) {
  // MangaDex@Home: pega baseUrl + hash + arquivos (URLs temporárias, resolvidas na hora).
  const body = await fetchUrl('https://api.mangadex.org/at-home/server/' + chapterId);
  const data = JSON.parse(body);
  const base = data.baseUrl;
  const hash = data.chapter && data.chapter.hash;
  const files = (data.chapter && data.chapter.data) || [];
  if (!base || !hash || !files.length) return [];
  return files.map(fn => `${base}/data/${hash}/${fn}`);
}

async function fetchMlChapterPages(mlId) {
  const body = await fetchUrl(`${API_ML}/media?parent=${mlId}&per_page=100`);
  const media = JSON.parse(body);
  if (!Array.isArray(media)) return [];
  return media.map(m => m.source_url).sort((a, b) => {
    const getNum = url => {
      const filename = url.substring(url.lastIndexOf('/') + 1);
      const match = filename.match(/^(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };
    return getNum(a) - getNum(b);
  });
}

function extractMfPageImages(html) {
  const urls = [...new Set(
    (html.match(/https?:\/\/images\.mangafreak\.me\/mangas\/[^"'\s)]+\.(?:jpe?g|png|webp)/gi) || [])
  )];
  urls.sort((a, b) => {
    const na = parseInt((a.match(/_(\d+)\.[a-z]+$/i) || [])[1] || '0', 10);
    const nb = parseInt((b.match(/_(\d+)\.[a-z]+$/i) || [])[1] || '0', 10);
    return na - nb;
  });
  return urls;
}

async function fetchEnChapterPages(slug, chNum) {
  try {
    const html = await fetchUrl(`${BASE_EN}/Read1_${slug}_${chNum}`);
    const imgs = extractMfPageImages(html);
    if (imgs.length > 0) return imgs;
  } catch (e) {}
  try {
    const mangaHtml = await fetchUrl(`${BASE_EN}/Manga/${slug}`);
    const esc   = String(slug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escCh = String(chNum).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkM = mangaHtml.match(new RegExp(`/Read\\d+_${esc}_${escCh}\\b`));
    if (linkM) {
      const html = await fetchUrl(`${BASE_EN}${linkM[0]}`);
      return extractMfPageImages(html);
    }
  } catch (e) {}
  return [];
}

function loadChaptersFile(mangaId) {
  try {
    const p = path.join(__dirname, '..', 'js', 'chapters', `${mangaId}.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return {};
}

async function fetchH20ChapterPages(chapterUrl) {
  try {
    const html = await fetchUrl(chapterUrl);
    const readerM = html.match(/ts_reader\.run\(([\s\S]+?)\);/);
    if (readerM) {
      try {
        const data = JSON.parse(readerM[1]);
        if (data.sources && data.sources[0] && Array.isArray(data.sources[0].images)) {
          return data.sources[0].images.map(img => img.trim());
        }
      } catch (e) {}
    }
    const pages = [];
    for (const m of html.matchAll(/<img[^>]+src="([^"]+img\.hentai1\.io[^"]+)"/gi)) {
      pages.push(m[1].trim());
    }
    return [...new Set(pages)];
  } catch (e) { return []; }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { mangaId, slug, chNum, lang = 'pt' } = req.query || {};
  if (!mangaId || !slug || !chNum) {
    return res.status(400).json({ success: false, error: 'Missing parameters: mangaId, slug, chNum' });
  }

  const normalLang = lang.toLowerCase() === 'en' ? 'en' : 'pt';

  try {
    let pages = [];

    // Tenta carregar o arquivo do capítulo primeiro para descobrir o src real
    const chapObj = loadChaptersFile(mangaId);
    const chList = chapObj[normalLang] || chapObj.pt || chapObj.en || [];
    const ch = chList.find(c => String(c.number) === String(chNum));

    if (ch) {
      if (ch.pages && ch.pages.length > 0) {
        pages = ch.pages;
      } else if (ch.src === 'hentai20') {
        if (ch.chapterUrl) {
          pages = await fetchH20ChapterPages(ch.chapterUrl);
        }
      } else if (ch.src === 'mundohentai') {
        // Se as páginas estiverem vazias e for mundohentai, retornamos o erro amigável de rodar localmente.
        // Se as páginas estiverem salvas no JSON, o if acima (ch.pages.length > 0) já as retornou com sucesso.
        return res.status(200).json({
          success: false,
          error: 'Conteúdo MundoHentai não está disponível pelo site. Abra o painel admin localmente.',
          pages: []
        });
      } else if (ch.src === 'mangadex' && ch.mdxId) {
        pages = await fetchMdxChapterPages(ch.mdxId);
      } else if (ch.src === 'mangalivre' && ch.mlId) {
        pages = await fetchMlChapterPages(ch.mlId);
      } else if (ch.src === 'leituramanga') {
        pages = await fetchPtChapterPages(slug, chNum);
      } else if (ch.src === 'mangafreak') {
        pages = await fetchEnChapterPages(slug, chNum);
      }
    }

    // Fallback caso não encontre o capítulo ou ele não tenha resolvido por src
    if (pages.length === 0) {
      if (normalLang === 'en') {
        pages = await fetchEnChapterPages(slug, chNum);
      } else {
        pages = await fetchPtChapterPages(slug, chNum);
      }
    }

    if (pages.length === 0) {
      return res.status(404).json({ success: false, error: 'Nenhuma página encontrada' });
    }

    res.status(200).json({ success: true, pages });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};
