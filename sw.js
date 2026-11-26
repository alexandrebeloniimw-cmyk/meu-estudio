// rede primeiro (recebe atualizações); cache para usar sem internet
const C = 'estudio-v1';
const F = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(F)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
