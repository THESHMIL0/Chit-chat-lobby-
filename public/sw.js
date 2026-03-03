// This lets the phone know our app has a background worker
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installed 😸');
});

// This is required for the worker to be valid, even if it does nothing yet
self.addEventListener('fetch', (event) => {
    // Just lets network requests pass through normally
});
