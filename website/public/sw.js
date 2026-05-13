/* WarrantyVault service worker — push receive + install */

const CACHE = 'wv-v1';
const OFFLINE_SHELL = ['/offline'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(OFFLINE_SHELL))
      .catch(() => void 0)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  // Network-first, fallback to offline shell for navigations.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/offline').then((r) => r || new Response('Offline', { status: 503 }))),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'WarrantyVault', body: 'Có cập nhật bảo hành' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // ignore parse error — use default payload
  }
  const { title, body, url = '/reminders', tag = 'warranty' } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icon.svg',
      badge: '/icon.svg',
      lang: 'vi',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/reminders';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      // If an existing tab is already on the target URL, just focus it.
      for (const client of clientList) {
        if (client.url.endsWith(url) && 'focus' in client) return client.focus();
      }
      // Else, navigate any open WarrantyVault tab to the target URL — avoids
      // opening a fresh tab when the user already has the app open.
      for (const client of clientList) {
        if ('navigate' in client && 'focus' in client) {
          try {
            await client.navigate(url);
            return client.focus();
          } catch {
            // navigate() can fail across origins or for detached clients — fall through.
          }
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
