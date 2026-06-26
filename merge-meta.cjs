const fs = require('fs');
const metaData = require('./js/mf-meta-data.json');

// Read data.js content
let dataJs = fs.readFileSync('./js/data.js', 'utf8');

// Extract the MANGA_DATA array
let updated = 0;
let genreSet = new Set();

const marker = dataJs.indexOf('MANGA_DATA = [');
if (marker < 0) throw new Error('MANGA_DATA não encontrado em data.js');
const arrayStart = dataJs.indexOf('[', marker);
// Find matching ] - count opening/closing brackets
let depth = 0;
let arrayEnd = arrayStart;
for (let i = arrayStart; i < dataJs.length; i++) {
  if (dataJs[i] === '[') depth++;
  if (dataJs[i] === ']') {
    depth--;
    if (depth === 0) { arrayEnd = i + 1; break; }
  }
}

const jsonStr = dataJs.substring(arrayStart, arrayEnd);
const mangaList = JSON.parse(jsonStr);
console.log('Parsed', mangaList.length, 'manga entries');

function normalizeGenre(g) {
  return g.replace(/_/g, ' ');
}

mangaList.forEach((m, i) => {
  // Check chapter file to set language availability flags
  const chPath = `./js/chapters/${m.id}.json`;
  let hasPt = false;
  let hasEn = m.lang === 'en'; // default for English manga
  
  if (fs.existsSync(chPath)) {
    try {
      const chData = JSON.parse(fs.readFileSync(chPath, 'utf8'));
      if (chData.pt && chData.pt.length > 0) hasPt = true;
      if (chData.en && chData.en.length > 0) hasEn = true;
    } catch (e) {}
  }
  m.hasPt = hasPt;
  m.hasEn = hasEn;

  const meta = metaData[m.slug];
  if (!meta) return;
  
  if (meta.description) m.description = meta.description;
  if (meta.genres && meta.genres.length > 0) {
    m.genres = meta.genres.map(normalizeGenre);
    meta.genres.forEach(g => genreSet.add(normalizeGenre(g)));
  }
  if (meta.author) m.author = meta.author;
  if (meta.artist) m.artist = meta.artist;
  if (meta.year) m.year = parseInt(meta.year, 10);
  if (meta.altTitle && meta.altTitle !== m.title) m.altTitle = meta.altTitle;
  updated++;
});

console.log('Manga updated:', updated);

// Build new ALL_GENRES
const allGenres = [...genreSet].sort();
console.log('Genres:', allGenres.length, allGenres.slice(0, 10), '...');

// Rebuild data.js
const newArrayJson = JSON.stringify(mangaList, null, 2);

// Functions to append
const functions = `
const ORIGINAL_MANGA_DATA = [...MANGA_DATA];
function applyGlobalMangaDataFilter() {
  if (typeof localStorage === 'undefined') return;
  try {
    let globalLang = 'all';
    
    // Check URL parameters first for lang override
    if (typeof window !== 'undefined' && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const urlLang = params.get('lang');
      if (urlLang === 'pt' || urlLang === 'en' || urlLang === 'all') {
        localStorage.setItem('ms_global_lang', JSON.stringify(urlLang));
        globalLang = urlLang;
      }
    }
    
    if (globalLang === 'all') {
      const val = localStorage.getItem('ms_global_lang');
      globalLang = val ? JSON.parse(val) : 'all';
    }
    
    const valAdult = localStorage.getItem('ms_adult_mode');
    const adultMode = valAdult ? JSON.parse(valAdult) : false;

    let list = [...ORIGINAL_MANGA_DATA];

    if (globalLang === 'pt') {
      list = list.filter(m => m.hasPt);
    } else if (globalLang === 'en') {
      list = list.filter(m => m.hasEn || m.lang === 'en');
    }

    /*
    if (!adultMode) {
      const adultGenres = ['Adulto', 'Hentai', 'Ecchi', 'Mature', 'Smut'];
      list = list.filter(m => {
        const genres = m.genres || [];
        return !genres.some(g => adultGenres.includes(g));
      });
    }
    */

    MANGA_DATA = list;
  } catch(e) {}
}
applyGlobalMangaDataFilter();

const CDN_MAP = {
  "$MFK": "https://images.mangafreak.me",
  "$TEMP": "https://temp.compsci88.com",
  "$HOT": "https://scans-hot.planeptune.us",
  "$LST": "https://scans.lastation.us",
  "$LOW": "https://official.lowee.us"
};

function resolveCdnUrl(url) {
  for (const [ph, domain] of Object.entries(CDN_MAP)) {
    if (url.startsWith(ph)) return url.replace(ph, domain);
  }
  return url;
}

function getManga(slugOrId) {
  return ORIGINAL_MANGA_DATA.find(m => m.slug === slugOrId || m.id === slugOrId);
}

function searchManga(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return MANGA_DATA.filter(m =>
    m.title.toLowerCase().includes(q) ||
    m.slug.includes(q)
  ).slice(0, 10);
}

function filterManga(opts) {
  opts = opts || {};
  const query = opts.query || '';
  const genres = opts.genres || [];
  const sort = opts.sort || 'recent';
  let results = MANGA_DATA;
  if (query) results = results.filter(m => searchManga(query).includes(m));
  if (genres.length > 0) results = results.filter(m => genres.every(g => (m.genres || []).includes(g)));
  switch (sort) {
    case 'title':
      results.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
      break;
    case 'chapters':
      results.sort((a, b) => (b.chaptersCount || 0) - (a.chaptersCount || 0));
      break;
    case 'recent':
    default:
      results.sort((a, b) => (b.chaptersCount || 0) - (a.chaptersCount || 0));
      break;
  }
  return results;
}

const ALL_GENRES = ${JSON.stringify(allGenres)};

function getAvailableGenres() {
  const adultGenres = ['Adulto', 'Hentai', 'Ecchi', 'Mature', 'Smut'];
  const adultMode = typeof localStorage !== 'undefined' && localStorage.getItem('ms_adult_mode') === 'true';
  if (adultMode) {
    const nonAdult = ALL_GENRES.filter(g => !adultGenres.includes(g));
    const activeAdult = ALL_GENRES.filter(g => adultGenres.includes(g));
    activeAdult.sort((a, b) => {
      if (a === 'Adulto') return -1;
      if (b === 'Adulto') return 1;
      return a.localeCompare(b, 'pt-BR');
    });
    return [...activeAdult, ...nonAdult];
  } else {
    return ALL_GENRES;
  }
}

let chaptersData = null;
let mfChaptersData = null;
let mfChaptersLoading = false;

function getChapterImageUrl(slug, chNumber, pageNum) {
  var slugLower = slug.toLowerCase().replace(/ /g, '_');
  var ch = String(chNumber);
  var chFolder = slugLower + '_' + ch;
  return 'https://images.mangafreak.me/mangas/' + slugLower + '/' + chFolder + '/' + chFolder + '_' + pageNum + '.jpg';
}

async function loadMfChapters() {
  if (mfChaptersData) return mfChaptersData;
  if (mfChaptersLoading) {
    while (mfChaptersLoading) await new Promise(r => setTimeout(r, 100));
    return mfChaptersData;
  }
  mfChaptersLoading = true;
  try {
    var res = await fetch('js/mf-chapters-data.json');
    var raw = await res.json();
    var out = {};
    Object.keys(raw).forEach(function(k) {
      out[k] = raw[k].map(function(ch) {
        return { id: ch.number, number: ch.number, title: ch.title, date: ch.date };
      });
    });
    mfChaptersData = out;
    return out;
  } catch(e) {
    return {};
  } finally {
    mfChaptersLoading = false;
  }
}

async function loadChapters(mangaId) {
  if (!mangaId) return {};
  var manga = getManga(mangaId);
  if (!manga) return {};

  if (!chaptersData) chaptersData = {};
  if (chaptersData[manga.id]) return chaptersData[manga.id];

  try {
    var res = await fetch('js/chapters/' + manga.id + '.json');
    var raw = await res.json();
    var mapped = {};
    Object.keys(raw).forEach(function(lang) {
      mapped[lang] = raw[lang].map(function(ch) {
        return {
          id: ch.id,
          number: ch.number,
          title: ch.title,
          date: ch.date,
          pages: ch.pages ? ch.pages.map(function(p) { return resolveCdnUrl(p); }) : []
        };
      });
    });
    chaptersData[manga.id] = mapped;
    return mapped;
  } catch(e) {
    chaptersData[manga.id] = {};
    return {};
  }
}

function getChapters(slug, lang) {
  lang = lang || 'en';
  var manga = getManga(slug);
  if (!manga) return [];
  if (!chaptersData || !chaptersData[manga.id]) return [];
  var entry = chaptersData[manga.id];
  if (lang !== 'en' && entry[lang]) return entry[lang];
  return entry['en'] || entry[Object.keys(entry)[0]] || [];
}

async function discoverPages(chapter, slug) {
  if (!chapter.pages || chapter.pages.length > 0) return chapter.pages;
  var cacheKey = 'pgcnt_' + slug + '_' + chapter.number;
  var cached = localStorage.getItem(cacheKey);
  if (cached) {
    var count = parseInt(cached, 10);
    if (count > 0) {
      var slugLower = slug.toLowerCase().replace(/ /g, '_');
      var ch = String(chapter.number);
      var chFolder = slugLower + '_' + ch;
      var pages = [];
      for (var i = 1; i <= count; i++) {
        pages.push('https://images.mangafreak.me/mangas/' + slugLower + '/' + chFolder + '/' + chFolder + '_' + i + '.jpg');
      }
      chapter.pages = pages;
      return pages;
    }
  }
  var pages = [];
  var batchSize = 3;
  var p = 1;
  var done = false;
  while (!done && p < 200) {
    var batch = [];
    for (var b = 0; b < batchSize; b++) batch.push(p + b);
    var results = await Promise.all(batch.map(function(n) {
      return testImageUrl(getChapterImageUrl(slug, chapter.number, n));
    }));
    for (var j = 0; j < results.length; j++) {
      if (results[j]) {
        pages.push(getChapterImageUrl(slug, chapter.number, batch[j]));
      } else {
        done = true;
        break;
      }
    }
    p += batchSize;
  }
  chapter.pages = pages;
  if (pages.length > 0) localStorage.setItem(cacheKey, String(pages.length));
  return pages;
}

function testImageUrl(url) {
  return new Promise(function(resolve) {
    var img = new Image();
    var timeout = setTimeout(function() { img.src = ''; resolve(false); }, 4000);
    img.onload = function() { clearTimeout(timeout); resolve(true); };
    img.onerror = function() { clearTimeout(timeout); resolve(false); };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}
`;

fs.writeFileSync('./js/data.js', 'let MANGA_DATA = ' + newArrayJson + ';\n' + functions);
const sizeMb = (Buffer.byteLength(newArrayJson, 'utf8') / 1024 / 1024).toFixed(2);
console.log('data.js written: ' + sizeMb + ' MB');
console.log('Total manga: ' + mangaList.length);
