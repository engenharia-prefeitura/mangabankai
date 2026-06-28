// build-ssg.cjs — gera páginas estáticas /manga/<id>/index.html para mangás
// NÃO adultos, com SEO completo (title, meta description, canonical, Open Graph,
// JSON-LD Book + BreadcrumbList) e conteúdo visível já no HTML, para o Google
// indexar sem depender de JavaScript.
//
// Roda no build da Vercel (ver vercel.json). NÃO é commitado pelo GitHub Actions
// — as páginas são geradas a cada deploy e servidas direto (pasta /manga ignorada
// no git). Uso manual:  node build-ssg.cjs
//
// As URLs limpas substituem manga.html?id=... para fins de indexação. Mangás
// adultos, ocultos, sem capítulos ou com id "sujo" continuam apenas no SPA.

const fs = require('fs');
const path = require('path');

const BASE_URL     = (process.env.SITE_URL || 'https://mangabankai.vercel.app').replace(/\/$/, '');
const DATA_JS_PATH = path.join(__dirname, 'js', 'data.js');
const CHAPTERS_DIR = path.join(__dirname, 'js', 'chapters');
const OUT_DIR      = path.join(__dirname, 'manga'); // /manga/<id>/index.html

// Gêneros que marcam conteúdo adulto — qualquer um deles exclui o mangá do SSG.
// Lista propositalmente abrangente: melhor manter +18 fora das URLs limpas.
const ADULT_GENRES = new Set([
  'Hentai', 'Hentai 3D', 'Mangá Hentai', 'Incesto hentai', 'Adult', 'Adulto',
  '+18', 'NSFW', 'Ecchi', 'Smut', 'Erotica', 'Erótico', 'Mature', 'Maduro',
  'Yaoi', 'Yuri', 'Bara', 'Shota', 'Shotacon', 'Loli', 'Lolicon', 'Doujinshi',
  'JAV', 'Ahegao', 'Netorare', 'Futanari', 'Succubus', 'BDSM', 'Sem Censura',
  'Obsceno', 'Inseki', 'Mindbreak', 'Paizuri', 'Creampie', 'Ahegao', 'Gyaru',
  'Dominatrix', 'Bondage', 'Gangbang', 'Grupal', 'Estupro', 'Sexual Violence',
  'Mulher Overpower', 'Boquete', 'Masturbação', 'Tentáculos'
]);

// ---- Parser de MANGA_DATA (string-aware, igual aos outros scripts de build) ----
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

function loadMangas() {
  const content = fs.readFileSync(DATA_JS_PATH, 'utf8');
  const { startIdx, endIdx } = bounds(content);
  return JSON.parse(content.substring(startIdx, endIdx));
}

// ---- Proxy de capa (mesma lógica do build-lite.cjs) ----
const PLACEHOLDER_PATTERNS = [
  'placeholder.jpg', 'placeholder.png', 'placeholder.webp', '/arrumar-tema',
  '/wp-content/themes/', 'placehold.co', 'via.placeholder.com', 'no-image',
  'noimage', 'sem-capa'
];
function proxyCover(cover) {
  if (!cover) return '';
  if (PLACEHOLDER_PATTERNS.some(p => cover.includes(p))) return '';
  const proxyPrefixes = [
    'https://images.mangafreak.me/', 'https://leituramanga.net/',
    'https://leituramanga.com/', 'https://cdn.leituramanga.net/',
    'https://mundohentaioficial.com/', 'https://mangalivre.blog/',
    'https://hentai20.io/'
  ];
  if (proxyPrefixes.some(prefix => cover.startsWith(prefix))) {
    return '/api/img-proxy?url=' + encodeURIComponent(cover);
  }
  return cover;
}

// ---- Elegibilidade (compartilhada com build-sitemap.cjs) ----
function isAdult(m) {
  return (m.genres || []).some(g => ADULT_GENRES.has(g));
}
// id precisa ser limpo (kebab) para virar caminho de URL bonito
function cleanId(m) {
  return (m.id && /^[a-z0-9-]+$/.test(m.id)) ? m.id : null;
}
function chaptersOf(id) {
  const p = path.join(CHAPTERS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
function hasChapters(chObj) {
  if (!chObj) return false;
  return Object.keys(chObj).some(l => Array.isArray(chObj[l]) && chObj[l].length > 0);
}
// Decide se um mangá ganha página estática + URL limpa no sitemap.
// Todos os mangás com id limpo e capítulos ganham SSG — adultos inclusive.
// O gate de conteúdo adulto é feito via JS na página gerada (não exclui do SSG).
function isEligible(m) {
  if (!m || !m.title || m.hidden) return false;
  if (!cleanId(m)) return false;
  return hasChapters(chaptersOf(m.id));
}
// Caminho da URL limpa (com barra final), ex: /manga/one-piece/
function cleanPath(m) {
  return '/manga/' + cleanId(m) + '/';
}

// ---- Escapes ----
function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function attrEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// JSON-LD seguro dentro de <script>: evita quebra por "</script>"
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

// Detecta descrições PT geradas por template (sem valor para SEO), ex:
// "Leia One Piece, um mangá em português." / "Leia X em português."
function isGeneratedDesc(d) {
  if (!d) return true;
  return /^Leia\s+.+?(,\s*um\s+mang[aá])?\s+em\s+portugu[eê]s\.?\s*$/i.test(d.trim());
}

// ---- Limpeza de sinopse (mesma do manga.html) ----
const SITE_NAME = 'MangaBankai';
function cleanSynopsis(text) {
  if (!text) return '';
  return text
    .replace(/,?\s*online\s+gr[aá]tis\s+no\s+Leitura\s+Manga\.?/gi, ' no ' + SITE_NAME + '.')
    .replace(/\s*Acompanhe\s+cap[ií]tulos\s+atualizados\s+com\s+imagens\s+em\s+alta\s+qualidade\.?/gi, '')
    .replace(/\s*no\s+Leitura\s+Manga\.?/gi, ' no ' + SITE_NAME + '.')
    .replace(/Leitura\s+Manga/gi, SITE_NAME)
    .replace(/leituramanga\.net/gi, 'mangabankai')
    .replace(/\.{2,}/g, '.').trim();
}

// Escolhe o idioma preferido (PT se houver capítulos PT) e a lista de capítulos.
function pickLangChapters(chObj) {
  const langs = Object.keys(chObj).filter(l => Array.isArray(chObj[l]) && chObj[l].length);
  const lang = langs.includes('pt') ? 'pt' : (langs[0] || 'en');
  const list = (chObj[lang] || []).slice().sort((a, b) =>
    (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0)
  );
  return { lang, list };
}

// ---- Geração de uma página ----
function renderPage(m, chObj) {
  const id = cleanId(m);
  const url = BASE_URL + cleanPath(m);
  const { lang, list } = pickLangChapters(chObj);
  const chCount = list.length || m.chaptersCount || 0;

  // Sinopse: prefere PT real, senão EN real, senão gerada.
  // descriptionPt costuma vir de um template ("Leia X em português.") — lixo
  // para SEO; só usamos se for texto real.
  const ptReal = (m.descriptionPt && m.descriptionPt.length > 30 && !isGeneratedDesc(m.descriptionPt))
    ? m.descriptionPt : '';
  const enReal = (m.description && m.description.length > 30) ? m.description : '';
  const rawSyn = ptReal || enReal || '';
  const synopsis = cleanSynopsis(rawSyn) ||
    ('Leia ' + m.title + ' online no ' + SITE_NAME + ', com capítulos atualizados em alta qualidade.');
  const metaDesc = synopsis.length > 160 ? synopsis.slice(0, 157).trim() + '…' : synopsis;

  const cover = proxyCover(m.cover);
  const absCover = cover && !/^https?:\/\//.test(cover) ? (BASE_URL + cover) : cover;

  const statusLabel = m.status === 'ongoing' ? 'Em Andamento' : 'Completo';
  const statusClass = m.status === 'ongoing' ? 'status-ongoing' : 'status-completed';
  const genres = (m.genres && m.genres.length) ? m.genres : ['Manga'];
  const title = m.title + ' — ' + SITE_NAME;

  const firstCh = list.length ? list[list.length - 1] : null; // menor número
  const lastCh  = list.length ? list[0] : null;               // maior número

  // JSON-LD: Book + BreadcrumbList
  const bookLd = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: m.title,
    url: url,
    bookFormat: 'https://schema.org/GraphicNovel',
    inLanguage: lang === 'pt' ? 'pt-BR' : 'en',
    description: synopsis.slice(0, 500),
    genre: genres,
    numberOfPages: chCount
  };
  if (absCover) bookLd.image = absCover;
  if (m.author) bookLd.author = { '@type': 'Person', name: m.author };
  if (m.year) bookLd.datePublished = String(m.year);
  if (m.rating && m.rating > 0) {
    bookLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(m.rating),
      bestRating: '10',
      ratingCount: Math.max(chCount, 1)
    };
  }
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: BASE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: 'Catálogo', item: BASE_URL + '/catalog.html' },
      { '@type': 'ListItem', position: 3, name: m.title, item: url }
    ]
  };

  // Tags de gênero (links root-relative para o catálogo)
  const genreTags = genres.map(g =>
    `<a class="tag" href="/catalog.html?genre=${encodeURIComponent(g)}">${htmlEscape(g)}</a>`
  ).join('');

  // Lista de capítulos (links para o leitor)
  const chapterItems = list.map(c => {
    const href = `/reader.html?manga=${id}&cap=${encodeURIComponent(c.number)}&lang=${lang}`;
    const date = c.date ? String(c.date).substring(0, 10) : '';
    return `<a class="chapter-item" href="${href}"><div class="left"><span class="ch-num">Capítulo ${htmlEscape(c.number)}</span><span class="ch-title">${htmlEscape(c.title || '')}</span></div><div class="right"><span class="ch-date">${htmlEscape(date)}</span></div></a>`;
  }).join('\n');

  const coverImg = absCover
    ? `<img src="${attrEscape(cover)}" alt="${attrEscape(m.title)}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/300x400/1a1a1a/444?text=?'">`
    : `<img src="https://placehold.co/300x400/1a1a1a/444?text=?" alt="${attrEscape(m.title)}">`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>${htmlEscape(title)}</title>
  <meta name="description" content="${attrEscape(metaDesc)}">
  <meta name="theme-color" content="#6c63ff">
  <link rel="canonical" href="${attrEscape(url)}">
  <link rel="manifest" href="/manifest.json">
  <meta property="og:type" content="book">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${attrEscape(title)}">
  <meta property="og:description" content="${attrEscape(metaDesc)}">
  <meta property="og:url" content="${attrEscape(url)}">
  <meta property="og:image" content="${attrEscape(absCover)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${attrEscape(absCover)}">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📖</text></svg>">
  <script type="application/ld+json">${jsonLd(bookLd)}</script>
  <script type="application/ld+json">${jsonLd(breadcrumbLd)}</script>
  <script src="/js/pub.js"></script>
</head>
<body>
  <script>ADS.guard();</script>
  <header class="header">
    <div class="header-inner">
      <a href="/index.html" class="logo"><img src="/img/logo.png" alt="MangaBankai" class="logo-img"></a>
      <button class="header-hamburger" aria-label="Abrir menu" onclick="toggleHeaderMenu()">☰</button>
      <div class="header-menu" id="headerMenu">
        <nav class="nav">
          <a href="/index.html">Início</a>
          <a href="/catalog.html">Catálogo</a>
        </nav>
      </div>
      <div class="header-menu-overlay" id="headerMenuOverlay" onclick="toggleHeaderMenu()"></div>
      <div class="search-bar">
        <input type="text" id="searchInput" placeholder="Pesquisar mangás..." autocomplete="off">
        <button class="search-btn" onclick="const q=document.getElementById('searchInput').value.trim();if(q)window.location.href='/catalog.html?q='+encodeURIComponent(q)">🔍</button>
        <div class="search-dropdown" id="searchDropdown"></div>
      </div>
    </div>
  </header>

  <div class="container">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/index.html">Início</a>
      <span class="sep">›</span>
      <a href="/catalog.html">Catálogo</a>
      <span class="sep">›</span>
      <span>${htmlEscape(m.title)}</span>
    </nav>
  </div>

  <!-- BANNER 300x250 (Início da Página) -->
  <div class="ad-banner-fixed" id="ad-ssg-300"></div>
  <script>ADS.renderBanner300(document.getElementById('ad-ssg-300'));</script>

  <div class="manga-detail-hero" id="mangaHero">
    <div class="hero-bg"></div>
    <div class="container content">
      <div class="cover">${coverImg}</div>
      <div class="hero-info">
        <h1>${htmlEscape(m.title)}</h1>
        <div class="alt-title">${htmlEscape(m.altTitle || '')}</div>
        <div class="tags">
          ${genreTags}
          <span class="tag ${statusClass}">${statusLabel}</span>
        </div>
        <div class="stats-row">
          <div class="stat"><div class="value">★ ${htmlEscape(m.rating || 0)}</div><div class="label">Avaliação</div></div>
          <div class="stat"><div class="value">${chCount}</div><div class="label">Capítulos</div></div>
          <div class="stat"><div class="value">${htmlEscape(m.year || '-')}</div><div class="label">Ano</div></div>
          <div class="stat"><div class="value">${htmlEscape(m.author || 'Desconhecido')}</div><div class="label">Autor</div></div>
        </div>
        <div class="actions" style="margin-top:20px; display:flex; gap:12px; flex-wrap:wrap;">
          ${firstCh ? `<a href="/reader.html?manga=${id}&cap=${encodeURIComponent(firstCh.number)}&lang=${lang}" class="btn btn-primary">📖 Começar Leitura</a>` : ''}
          ${lastCh ? `<a href="/reader.html?manga=${id}&cap=${encodeURIComponent(lastCh.number)}&lang=${lang}" class="btn btn-secondary">Último Capítulo</a>` : ''}
        </div>
      </div>
    </div>
  </div>

  <div class="detail-body container">
    <h2>Sinopse</h2>
    <div class="description">${htmlEscape(synopsis)}</div>
    <div class="info-grid">
      <div class="info-item"><label>Autor</label><span>${htmlEscape(m.author || 'Desconhecido')}</span></div>
      <div class="info-item"><label>Artista</label><span>${htmlEscape(m.artist || m.author || 'Desconhecido')}</span></div>
      <div class="info-item"><label>Ano de Lançamento</label><span>${htmlEscape(m.year || '-')}</span></div>
      <div class="info-item"><label>Status</label><span>${statusLabel}</span></div>
      <div class="info-item"><label>Total de Capítulos</label><span>${chCount}</span></div>
      <div class="info-item"><label>Avaliação</label><span>★ ${htmlEscape(m.rating || 0)}</span></div>
    </div>

    <div class="chapter-section">
      <div class="ch-toolbar"><h2>Lista de Capítulos (${chCount})</h2></div>
      <!-- NATIVE BANNER (Antes da Lista de Capítulos) -->
      <div class="ad-banner-fixed" id="ad-ssg-native" style="margin:0 auto 16px;"></div>
      <script>ADS.lazy(document.getElementById('ad-ssg-native'), ADS.renderNative);</script>
      <div class="chapter-list">
${chapterItems}
      </div>
    </div>
  </div>

  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <div class="logo"><img src="/img/logo.png" alt="MangaBankai" class="logo-img"></div>
          <p>Sua plataforma para ler mangás online. Todos os links são fornecidos por parceiros legais autorizados.</p>
        </div>
        <div>
          <h4>Navegação</h4>
          <ul>
            <li><a href="/index.html">Início</a></li>
            <li><a href="/catalog.html">Catálogo</a></li>
            <li><a href="/terms.html">Termos de Uso</a></li>
          </ul>
        </div>
        <div>
          <h4>Gêneros</h4>
          <ul>
            <li><a href="/catalog.html?genre=Ação">Ação</a></li>
            <li><a href="/catalog.html?genre=Comédia">Comédia</a></li>
            <li><a href="/catalog.html?genre=Fantasia">Fantasia</a></li>
          </ul>
        </div>
        <div>
          <h4>Status</h4>
          <ul>
            <li><a href="/catalog.html?status=ongoing">Em Andamento</a></li>
            <li><a href="/catalog.html?status=completed">Completo</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; 2026 ${SITE_NAME}. Lages-SC. Os links deste site são de fontes legais e autorizadas.</p>
      </div>
    </div>
  </footer>

  <script src="/js/data-lite.js"></script>
  <script src="/js/main.js"></script>
  <script>
    // Gate adulto: mesma lógica do manga.html. Se o mangá for +18 e o modo
    // adulto estiver desativado, exibe o modal de confirmação.
    (function() {
      const _adultGenres = ['Adulto','Hentai','Hentai 3D','Mangá Hentai','Incesto hentai','Adult','+18','NSFW','Ecchi','Smut','Erotica','Erótico','Mature','Maduro','Yaoi','Yuri','Bara','Shota','Shotacon','Loli','Lolicon','Doujinshi','JAV','Ahegao','Netorare','Futanari','Succubus','BDSM','Sem Censura','Obsceno','Inseki','Mindbreak','Paizuri','Creampie','Gyaru','Dominatrix','Bondage','Gangbang','Grupal','Estupro','Sexual Violence','Mulher Overpower','Boquete','Masturbação','Tentáculos'];
      const _manga = getManga('${htmlEscape(m.id)}');
      if (_manga && (_manga.genres || []).some(function(g){ return _adultGenres.indexOf(g) !== -1; })) {
        if (!LS.get('adult_mode', false)) {
          showAdultConfirmationModal(
            function() { LS.set('adult_mode', true); },
            function() { window.location.href = '/index.html'; }
          );
        }
      }
    })();
  </script>
  <script>ADS.renderSocialBar();</script>
</body>
</html>
`;
}

function buildSSG() {
  const arr = loadMangas();

  // Limpa saída anterior (pasta gerada; manga.html NÃO é afetado)
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let generated = 0, skipped = 0;
  for (const m of arr) {
    if (!isEligible(m)) { skipped++; continue; }
    const chObj = chaptersOf(m.id);
    const dir = path.join(OUT_DIR, cleanId(m));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPage(m, chObj), 'utf8');
    generated++;
  }
  return { total: arr.length, generated, skipped };
}

module.exports = { buildSSG, isEligible, cleanPath, cleanId, isAdult, ADULT_GENRES };

if (require.main === module) {
  const r = buildSSG();
  console.log(`✅ SSG: ${r.generated} páginas geradas em /manga/<id>/ (${r.skipped} puladas de ${r.total})`);
}
