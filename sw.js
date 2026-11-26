// rede primeiro (recebe atualizações); cache para usar sem internet
const C = 'estudio-v3';
const LIBS = 'https://cdn.jsdelivr.net/';
const F = ['./', 'index.html', 'app.js', 'legendas.js', 'worker.js', 'desenho.js', 'fundo.js', 'online.js', 'exportador.js', 'vendor/mediabunny.min.mjs', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(F)).then(() => self.skipWaiting())));
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
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
