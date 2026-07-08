// Cache offline do MangaBankai.
// Estratégia:
//  - imagens (capas/páginas): cache-first (leitura offline)
//  - html/css/js/data: network-first (sempre fresco; cache só p/ offline)
const CACHE = 'mangabankai-v2';
const SHELL = [
  'index.html', 'catalog.html', 'manga.html', 'reader.html',
  'css/style.css', 'css/reader.css', 'js/main.js', 'js/data-lite.js', 'js/pub.js'
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

// ── Web Push ────────────────────────────────────────────────────────────────
// Recebe o push (capítulo novo) e mostra a notificação.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || 'MangaBankai';
  const options = {
    body: data.body || 'Novo capítulo disponível!',
    icon: data.icon || '/img/loading-circ/frame_000.webp',
    badge: '/img/loading-circ/frame_000.webp',
    image: data.image || undefined,
    tag: data.tag || 'mangabankai-chapter',
    renotify: true,
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Ao clicar na notificação, foca uma aba aberta ou abre a URL da obra.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate && c.navigate(target); return c.focus(); }
      }
      return self.clients.openWindow(target);
    })
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
