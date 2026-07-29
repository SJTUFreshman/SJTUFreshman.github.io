"use strict";

const CACHE_PREFIX = "runde-desktop-pet-";
const CACHE_NAME = `${CACHE_PREFIX}20260729-v3`;
const PET_DIRECTORIES = [
    "/assets/mochi/",
    "/assets/appcopilot/",
    "/assets/timo/"
];

self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(
            names
                .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
                .map((name) => caches.delete(name))
        );
        await self.clients.claim();
    })());
});

function isPetAsset(request) {
    if (request.method !== "GET") return false;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, "");
    return PET_DIRECTORIES.some((directory) => (
        url.pathname.startsWith(`${scopePath}${directory}`)
    ));
}

self.addEventListener("fetch", (event) => {
    if (!isPetAsset(event.request)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;

        const response = await fetch(event.request);
        if (response.ok && response.type === "basic") {
            try {
                await cache.put(event.request, response.clone());
            } catch (error) {
                // Quota or privacy restrictions should not block the companion.
            }
        }
        return response;
    })());
});
