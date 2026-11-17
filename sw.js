// Bump VERSION whenever you change any app file so phones pick up the update.
const VERSION = 'roastcast-v1';
const ASSETS = [
  './', './index.html', './styles.css', './model.js', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Jost:wght@500;700;800&display=swap';

// Pre-cache the Jost fallback font so it works offline from the very first install.
async function cacheFonts(c) {
  try {
    const res = await fetch(FONT_CSS);
    if (!res.ok) return;
    await c.put(FONT_CSS, res.clone());
    const urls = (await res.text()).match(/https:\/\/fonts\.gstatic\.com\/[^)'"]+/g) || [];
    await Promise.all(urls.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r)).catch(() => {})));
  } catch { /* offline during install: fonts get cached on next online launch */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(ASSETS).then(() => cacheFonts(c)))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts (Jost fallback): cache on first online use, then serve offline.
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req.url, { ignoreVary: true });
      const net = fetch(req).then(res => { c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // App shell: cache first, fall back to network, then to index for navigations.
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
    return res;
  }).catch(() => req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
