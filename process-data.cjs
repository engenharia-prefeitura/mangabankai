const fs = require('fs');
const path = require('path');

const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'js', 'manga-meta.json'), 'utf8'));

const CDN_MAP = {
  '$TEMP': 'https://temp.compsci88.com',
  '$HOT': 'https://scans-hot.planeptune.us',
  '$LST': 'https://scans.lastation.us',
  '$LOW': 'https://official.lowee.us',
  '$MFK': 'https://images.mangafreak.me'
};

// Enrich metadata with defaults for fields the HTML expects
const enriched = meta.map(m => ({
  id: m.slug,
  slug: m.slug,
  title: m.title,
  altTitle: '',
  cover: m.cover,
  banner: m.cover,
  author: 'Desconhecido',
  artist: 'Desconhecido',
  status: 'ongoing',
  year: m.latestChapter ? parseInt(m.latestChapter.date) : 2024,
  rating: 0,
  genres: ['Manga'],
  description: 'Leia ' + m.title + ' online no MangaSurge.',
  chaptersCount: m.chapters,
  lang: m.lang,
  hasPt: m.hasPt,
  latestChapter: m.latestChapter
}));

function escapeJs(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

const cdnMapStr = JSON.stringify(CDN_MAP, null, 2);
const mangaDataStr = JSON.stringify(enriched, null, 2);

const output = `const MANGA_DATA = ${mangaDataStr};

const CDN_MAP = ${cdnMapStr};

function resolveCdnUrl(url) {
  for (const [ph, domain] of Object.entries(CDN_MAP)) {
    if (url.startsWith(ph)) return url.replace(ph, domain);
  }
  return url;
}

function getManga(slugOrId) {
  return MANGA_DATA.find(m => m.slug === slugOrId || m.id === slugOrId);
}

function searchManga(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return MANGA_DATA.filter(m =>
    m.title.toLowerCase().includes(q) ||
    m.altTitle.toLowerCase().includes(q) ||
    m.slug.includes(q)
  ).slice(0, 10);
}

function filterManga(opts) {
  opts = opts || {};
  const genres = opts.genres || [];
  const status = opts.status || '';
  const sort = opts.sort || 'recent';
  const query = opts.query || '';
  const yearMin = opts.yearMin || '';
  const yearMax = opts.yearMax || '';
  const ratingMin = opts.ratingMin || '';
  let results = MANGA_DATA;
  if (query) results = results.filter(m => searchManga(query).includes(m));
  if (genres.length) results = results.filter(m => genres.every(g => m.genres && m.genres.includes(g)));
  if (status) results = results.filter(m => m.status === status);
  if (yearMin) results = results.filter(m => m.year >= parseInt(yearMin));
  if (yearMax) results = results.filter(m => m.year <= parseInt(yearMax));
  if (ratingMin) results = results.filter(m => m.rating >= parseFloat(ratingMin));
  switch (sort) {
    case 'title': results.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')); break;
    case 'rating': results.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
    case 'year': results.sort((a, b) => (b.year || 0) - (a.year || 0)); break;
    case 'oldest': results.sort((a, b) => (a.year || 9999) - (b.year || 9999)); break;
    case 'recent': default:
      results.sort((a, b) => {
        const aD = a.latestChapter ? a.latestChapter.date : '';
        const bD = b.latestChapter ? b.latestChapter.date : '';
        return bD.localeCompare(aD);
      });
      break;
  }
  return results;
}

const ALL_GENRES = ['Acao', 'Aventura', 'Comedia', 'Drama', 'Fantasia', 'Horror', 'Magia', 'Mecha', 'Misterio', 'Psicologico', 'Romance', 'Sci-Fi', 'Seinen', 'Shoujo', 'Shounen', 'Slice of Life', 'Sobrenatural', 'Esportes', 'Suspense', 'Terror', 'Isekai'];

// Chapter data cache (loaded async only when needed)
let chaptersData = null;
let chaptersLoading = false;

async function loadChapters() {
  if (chaptersData) return chaptersData;
  if (chaptersLoading) {
    return new Promise(function(resolve) {
      var check = setInterval(function() {
        if (chaptersData) { clearInterval(check); resolve(chaptersData); }
      }, 100);
    });
  }
  chaptersLoading = true;
  try {
    var res = await fetch('js/chapters.json');
    var raw = await res.json();
    var map = {};
    var suffixes = ['pt', 'es', 'fr', 'de', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'bn', 'id', 'ms', 'th', 'vi', 'tl'];
    Object.keys(raw).forEach(function(k) {
      var slug = k;
      var lang = 'en';
      for (var i = 0; i < suffixes.length; i++) {
        if (k.endsWith('-' + suffixes[i])) { slug = k.slice(0, -(suffixes[i].length + 1)); lang = suffixes[i]; break; }
      }
      if (!map[slug]) map[slug] = {};
      map[slug][lang] = raw[k].map(function(ch) {
        return { id: ch.id, number: ch.number, title: ch.title, date: ch.releaseDate, pages: ch.pages ? ch.pages.map(function(p) { return resolveCdnUrl(p); }) : [] };
      });
    });
    chaptersData = map;
    return map;
  } catch(e) {
    console.warn('Failed to load chapters:', e);
    return {};
  }
}

function getChapters(slug, lang) {
  lang = lang || 'en';
  if (chaptersData) {
    var entry = chaptersData[slug];
    if (!entry) return [];
    if (lang !== 'en' && entry[lang]) return entry[lang];
    return entry['en'] || [];
  }
  return [];
}
`;

fs.writeFileSync(path.join(__dirname, 'js', 'data.js'), output, 'utf8');
console.log('✓ js/data.js generated (' + (output.length / 1024).toFixed(1) + ' KB)');
