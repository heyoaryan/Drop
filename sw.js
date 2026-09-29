// Drop PWA — Service Worker
// Strategy:
//   - App shell (HTML, icons, manifest) → Cache-first, background update
//   - Supabase API / Realtime → Network-only (live data, can't cache)
//   - CDN JS (supabase SDK) → Stale-while-revalidate
//   - Images from Supabase Storage → Cache-first with 7-day expiry

const CACHE_NAME = 'drop-shell-v1';
const RUNTIME_CACHE = 'drop-runtime-v1';

const SHELL_ASSETS = [
  '/Drop.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

// ── Message handler (e.g. SKIP_WAITING from update toast) ───────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  const VALID = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !VALID.includes(k)).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never intercept non-GET requests (POST/PUT/DELETE for Supabase)
  if (request.method !== 'GET') return;

  // 2. Never intercept Supabase API or Realtime WebSocket calls
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.in') ||
    request.url.includes('/rest/v1/') ||
    request.url.includes('/realtime/') ||
    request.url.includes('/storage/v1/')
  ) {
    // Supabase storage public files (images) → cache-first with expiry
    if (request.url.includes('/storage/v1/object/public/')) {
      event.respondWith(cacheFirstWithExpiry(request, RUNTIME_CACHE, 7));
      return;
    }
    // Everything else Supabase → network only
    return;
  }

  // 3. Supabase CDN JS (SDK) → stale-while-revalidate
  if (
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('unpkg.com')
  ) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // 4. App shell assets → cache-first, fall back to network
  event.respondWith(cacheFirst(request));
});

// ── Strategies ────────────────────────────────────────────────────────────────

// Cache-first: serve from cache, fall back to network and update cache
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline fallback → return cached Drop.html if available
    const fallback = await caches.match('/Drop.html');
    if (fallback) return fallback;
    return new Response('Offline — please reconnect', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Stale-while-revalidate: serve cache immediately, refresh in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || networkFetch;
}

// Cache-first with day-based expiry for storage images
async function cacheFirstWithExpiry(request, cacheName, maxAgeDays) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    const dateHeader = cached.headers.get('date');
    if (dateHeader) {
      const age = (Date.now() - new Date(dateHeader).getTime()) / 86400000;
      if (age < maxAgeDays) return cached;
    } else {
      return cached; // no date header, serve anyway
    }
  }

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}
