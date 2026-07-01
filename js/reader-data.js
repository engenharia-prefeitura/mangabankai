// reader-data.js — dados SOB DEMANDA para o leitor.
// Fast path: o servidor (api/og-chapter) injeta window.__MB_MANGA__ (a meta do
//   único mangá do capítulo) → definimos aqui só o necessário, SEM baixar o
//   catálogo inteiro (data-lite ~670 KB brotli / 2,8 MB parse).
// Fallback: se não houver injeção (ex.: /reader.html?manga=… quando o og-chapter
//   falha), carrega o data-lite completo para a leitura nunca quebrar.
(function () {
  if (!window.__MB_MANGA__) {
    // Sem injeção → carrega o catálogo completo (compatível com o comportamento antigo).
    document.write('<script src="/js/data-lite.js"><\/script>');
    return;
  }

  var SOLO = window.__MB_MANGA__;

  var CDN_MAP = {
    "$MFK": "https://images.mangafreak.me",
    "$TEMP": "https://temp.compsci88.com",
    "$HOT": "https://scans-hot.planeptune.us",
    "$LST": "https://scans.lastation.us",
    "$LOW": "https://official.lowee.us"
  };
  function resolveCdnUrl(url) {
    for (var ph in CDN_MAP) { if (url.indexOf(ph) === 0) return url.replace(ph, CDN_MAP[ph]); }
    return url;
  }

  // Só conhece o mangá injetado (por id ou slug). Related fica ausente (guardado no reader).
  window.getManga = function (slugOrId) {
    if (SOLO && (SOLO.id === slugOrId || SOLO.slug === slugOrId)) return SOLO;
    return undefined;
  };

  // chaptersData é global (o reader o acessa como window.chaptersData).
  if (!window.chaptersData) window.chaptersData = null;
  var mfChaptersData = null;
  var mfChaptersLoading = false;

  window.getChapterImageUrl = function (slug, chNumber, pageNum) {
    var slugLower = slug.toLowerCase().replace(/ /g, '_');
    var chFolder = slugLower + '_' + String(chNumber);
    return 'https://images.mangafreak.me/mangas/' + slugLower + '/' + chFolder + '/' + chFolder + '_' + pageNum + '.jpg';
  };

  window.loadMfChapters = async function () {
    if (mfChaptersData) return mfChaptersData;
    if (mfChaptersLoading) { while (mfChaptersLoading) await new Promise(function (r) { setTimeout(r, 100); }); return mfChaptersData; }
    mfChaptersLoading = true;
    try {
      var res = await fetch('/js/mf-chapters-data.json');
      var raw = await res.json();
      var out = {};
      Object.keys(raw).forEach(function (k) {
        out[k] = raw[k].map(function (ch) { return { id: ch.number, number: ch.number, title: ch.title, date: ch.date }; });
      });
      mfChaptersData = out;
      return out;
    } catch (e) { return {}; }
    finally { mfChaptersLoading = false; }
  };

  window.loadChapters = async function (mangaId) {
    if (!mangaId) return {};
    var manga = window.getManga(mangaId);
    if (!manga) return {};
    if (!window.chaptersData) window.chaptersData = {};
    if (window.chaptersData[manga.id]) return window.chaptersData[manga.id];
    try {
      var res = await fetch('/js/chapters/' + manga.id + '.json');
      var raw = await res.json();
      var mapped = {};
      Object.keys(raw).forEach(function (lang) {
        mapped[lang] = raw[lang].map(function (ch) {
          var entry = { id: ch.id, number: ch.number, title: ch.title, date: ch.date, pages: ch.pages ? ch.pages.map(function (p) { return resolveCdnUrl(p); }) : [] };
          if (ch.src) entry.src = ch.src;
          if (ch.mdxId) entry.mdxId = ch.mdxId;
          if (ch.mlId) entry.mlId = ch.mlId;
          if (ch.chapterUrl) entry.chapterUrl = ch.chapterUrl;
          return entry;
        });
      });
      window.chaptersData[manga.id] = mapped;
      return mapped;
    } catch (e) { window.chaptersData[manga.id] = {}; return {}; }
  };

  window.getChapters = function (slug, lang) {
    lang = lang || 'en';
    var manga = window.getManga(slug);
    if (!manga) return [];
    if (!window.chaptersData || !window.chaptersData[manga.id]) return [];
    var entry = window.chaptersData[manga.id];
    return (entry[lang] && entry[lang].length > 0) ? entry[lang] : [];
  };

  window.testImageUrl = function (url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var timeout = setTimeout(function () { img.src = ''; resolve(false); }, 4000);
      img.onload = function () { clearTimeout(timeout); resolve(true); };
      img.onerror = function () { clearTimeout(timeout); resolve(false); };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  };

  window.discoverPages = async function (chapter, slug) {
    if (!chapter.pages || chapter.pages.length > 0) return chapter.pages;
    var cacheKey = 'pgcnt_' + slug + '_' + chapter.number;
    var cached = localStorage.getItem(cacheKey);
    if (cached) {
      var count = parseInt(cached, 10);
      if (count > 0) {
        var slugLower = slug.toLowerCase().replace(/ /g, '_');
        var chFolder = slugLower + '_' + String(chapter.number);
        var arr = [];
        for (var i = 1; i <= count; i++) arr.push('https://images.mangafreak.me/mangas/' + slugLower + '/' + chFolder + '/' + chFolder + '_' + i + '.jpg');
        chapter.pages = arr;
        return arr;
      }
    }
    var pages = [];
    var p = 1, done = false;
    while (!done && p < 200) {
      var batch = [p, p + 1, p + 2];
      var results = await Promise.all(batch.map(function (n) { return window.testImageUrl(window.getChapterImageUrl(slug, chapter.number, n)); }));
      for (var j = 0; j < results.length; j++) {
        if (results[j]) pages.push(window.getChapterImageUrl(slug, chapter.number, batch[j]));
        else { done = true; break; }
      }
      p += 3;
    }
    chapter.pages = pages;
    if (pages.length > 0) localStorage.setItem(cacheKey, String(pages.length));
    return pages;
  };
})();
