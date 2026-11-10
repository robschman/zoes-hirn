/* Zoe's Hirn – Service Worker: App offline öffnen und Push-Mitteilungen anzeigen */
const CACHE = 'zh-v1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'vendor/supabase-2.118.0.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png', 'icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Zuerst aus dem Netz (damit Neuerungen sofort ankommen), ohne Netz aus dem Speicher
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { titel: "Zoe's Hirn", text: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titel || "Zoe's Hirn", {
    body: d.text || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' }, tag: 'zh-erinnerung'
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(e.notification.data.url || './');
  }));
});
