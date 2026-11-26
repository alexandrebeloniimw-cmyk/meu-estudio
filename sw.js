// rede primeiro (recebe atualizações); cache para usar sem internet
const C = 'estudio-v12';
const LIBS = 'https://cdn.jsdelivr.net/';
const F = ['./', 'index.html', 'app.js', 'legendas.js', 'worker.js', 'desenho.js', 'fundo.js', 'online.js', 'exportador.js', 'corte.js', 'quadro.js', 'editor.js', 'montador.js', 'cortador.js', 'vendor/mediabunny.min.mjs', 'vendor/anton-latin-400-normal.woff2', 'vendor/bangers-latin-400-normal.woff2', 'vendor/bebas-neue-latin-400-normal.woff2', 'vendor/lobster-latin-400-normal.woff2', 'vendor/montserrat-latin-800-normal.woff2', 'vendor/oswald-latin-700-normal.woff2', 'vendor/pacifico-latin-400-normal.woff2', 'vendor/playfair-display-latin-700-normal.woff2', 'vendor/poppins-latin-800-normal.woff2', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(F.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(k => Promise.all(k.filter(n => n.startsWith('estudio-') && n !== C).map(n => caches.delete(n))))
  .then(() => self.clients.claim())));
// tocar no aviso traz o app de volta
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => l[0] ? l[0].focus() : self.clients.openWindow('./')));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // biblioteca de transcrição: versão fixa, guardada para usar sem internet
  if (e.request.url.startsWith(LIBS)) {
    e.respondWith(caches.open(C).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (!e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
