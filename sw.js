// Minimalny Service Worker - wymagany do instalacji aplikacji (PWA) w niektorych
// przegladarkach. Panel zawsze potrzebuje swiezych danych z serwera (statusy
// urzadzen, ping, itd.), wiec celowo NIC nie cachuje - kazde zadanie idzie
// normalnie do sieci, tak jak bez service workera.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
