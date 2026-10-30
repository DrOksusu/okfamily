const CACHE_NAME = 'password-manager-v2';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/crypto.js',
    './js/api.js',
    './js/biometric.js',
    './js/paste-parser.js',
    './manifest.json'
];

// 설치 시 정적 파일 캐싱
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            // HTTP 캐시를 거치지 않고 최신 파일로 채움 (구/신 파일 혼재 방지)
            .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

// 활성화 시 이전 캐시 정리
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// 요청 가로채기 - 네트워크 우선 전략 (보안 수정 즉시 반영, 오프라인이면 캐시)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // API 등 다른 origin 요청과 GET 외 요청은 서비스워커가 관여하지 않음
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
