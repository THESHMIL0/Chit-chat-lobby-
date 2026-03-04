// A simple service worker to allow PWA installation
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Install');
});

self.addEventListener('fetch', (e) => {
    // Just lets the browser handle requests normally
});
