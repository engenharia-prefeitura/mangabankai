// api/og-chapter.js — entrega o reader.html com as tags Open Graph do CAPÍTULO
// injetadas no servidor (capa do mangá, título "Mangá — Capítulo X", descrição),
// para que WhatsApp/Telegram/Twitter/Facebook mostrem uma prévia rica.
//
// Os robôs de redes sociais NÃO executam JS, então o og: dinâmico do reader não
// chega a eles — por isso injetamos aqui. Atende /manga/:id/:cap via rewrite.
//
// SEGURANÇA: se qualquer coisa falhar, faz fallback para /reader.html?manga&cap
// (o leitor lê esses params), então a LEITURA nunca quebra.

const fs = require('fs');
const path = require('path');

const SITE = (process.env.SITE_URL || 'https://mangabankai.vercel.app').replace(/\/$/, '');

let _reader = null;
function loadReader() {
  if (_reader == null) _reader = fs.readFileSync(path.join(__dirname, '..', 'reader.html'), 'utf8');
  return _reader;
}

// Índice completo (slim) a partir do data-lite.js — inclui gêneros/slug/capa,
// necessários para injetar a meta do mangá no leitor (leitura sob demanda).
let _mangas = null;
function loadMangas() {
  if (_mangas == null) {
    try {
      const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'data-lite.js'), 'utf8');
      const marker = js.indexOf('MANGA_DATA = [');
      const start = js.indexOf('[', marker);
      let depth = 0, inStr = false, esc = false, end = start;
      for (let i = start; i < js.length; i++) {
        const c = js[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (!inStr) { if (c === '[') depth++; else if (c === ']') { depth--; if (!depth) { end = i + 1; break; } } }
      }
      _mangas = JSON.parse(js.substring(start, end));
    } catch (e) {
      try { _mangas = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'js', 'manga-search.json'), 'utf8')); }
      catch (e2) { _mangas = []; }
    }
  }
  return _mangas;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getParam(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  try { return new URL(req.url, 'http://x').searchParams.get(name) || ''; } catch (e) { return ''; }
}

function setAttr(html, idAttr, attr, value) {
  // Substitui o valor de `attr` na tag que tem id="idAttr".
  const re = new RegExp('(id="' + idAttr + '"[^>]*?' + attr + '=")[^"]*(")');
  return html.replace(re, (_, a, b) => a + esc(value) + b);
}

module.exports = async (req, res) => {
  const mangaId = getParam(req, 'manga');
  const cap = getParam(req, 'cap');

  try {
    let html = loadReader();
    const m = loadMangas().find(x => x && x.id === mangaId);
    const url = SITE + '/manga/' + encodeURIComponent(mangaId) + '/' + encodeURIComponent(cap);

    let title, desc, image;
    if (m) {
      title = m.title + ' — Capítulo ' + cap + ' — MangaBankai';
      desc = 'Leia ' + m.title + ' capítulo ' + cap + ' online grátis no MangaBankai.';
      const cover = m.cover || '';
      image = cover ? (/^https?:\/\//.test(cover) ? cover : SITE + cover) : SITE + '/img/logo.png';
    } else {
      title = 'Leitor — MangaBankai';
      desc = 'Leia capítulos de mangá online no MangaBankai.';
      image = SITE + '/img/logo.png';
    }

    // Injeta a meta do ÚNICO mangá → o leitor não baixa o catálogo (leitura sob demanda).
    // Se o mangá não for encontrado, não injeta e o reader-data.js cai no data-lite.
    if (m) {
      const mangaJson = JSON.stringify(m).replace(/</g, '\\u003c');
      html = html.replace(
        '<script src="/js/reader-data.js"></script>',
        '<script>window.__MB_MANGA__=' + mangaJson + ';</script><script src="/js/reader-data.js"></script>'
      );
    }

    html = html.replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>');
    html = setAttr(html, 'metaDesc', 'content', desc);
    html = setAttr(html, 'ogTitle', 'content', title);
    html = setAttr(html, 'ogDesc', 'content', desc);
    html = setAttr(html, 'ogImage', 'content', image);
    html = setAttr(html, 'ogUrl', 'content', url);
    html = setAttr(html, 'twImage', 'content', image);
    html = setAttr(html, 'canonical', 'href', url);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cacheia na borda da Vercel → pouquíssimas invocações mesmo com tráfego.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(html);
  } catch (e) {
    // Fallback à prova de falha: o leitor lê manga/cap por query.
    res.setHeader('Location', '/reader.html?manga=' + encodeURIComponent(mangaId) + '&cap=' + encodeURIComponent(cap));
    res.status(302).end();
  }
};
