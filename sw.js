// Cache offline do MangaBankai.
// Estratégia:
//  - imagens (capas/páginas): cache-first (leitura offline)
//  - html/css/js/data: network-first (sempre fresco; cache só p/ offline)
const CACHE = 'mangabankai-v2';
const SHELL = [
  'index.html', 'catalog.html', 'manga.html', 'reader.html',
  'css/style.css', 'css/reader.css', 'js/main.js', 'js/data-lite.js', 'js/ads.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Nunca intercepta o servidor de resolução do painel (porta 3001).
  if (url.port === '3001') return;

  // Imagens: cache-first (capas e páginas de capítulo já lidas funcionam offline).
  if (req.destination === 'image') {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r && (r.ok || r.type === 'opaque')) {
          const copy = r.clone();
          caches.open(CACHE).then(ch => ch.put(req, copy));
        }
        return r;
      }).catch(() => hit))
    );
    return;
  }

  // Resto: network-first (conteúdo/codigo sempre fresco online; cache p/ offline).
  e.respondWith(
    fetch(req).then(r => {
      if (r && r.ok && url.origin === location.origin) {
        const copy = r.clone();
        caches.open(CACHE).then(ch => ch.put(req, copy));
      }
      return r;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
