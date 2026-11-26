/**
 * ============================================================================
 * ВОЛНА ЛАУНДЖ — SERVICE WORKER (PWA v2.5)
 * ============================================================================
 * Обеспечивает:
 *  1. Нативную установку меню на экран смартфона (Android + iOS).
 *  2. Стратегию Network-First для index.html — при обновлении цен на GitHub
 *     гости сразу видят свежее меню, а без интернета открывается сохранённая копия.
 *  3. Прямой обход кэша для Google Apps Script (календарь занятых дат и заявки)
 *     и Яндекс Метрики — даты и аналитика всегда актуальны.
 *  4. Мгновенную загрузку локальных фото блюд (папка img/) и иконок.
 */

const CACHE_VERSION = 'volna-lounge-v2.5';

// Базовые файлы, которые кэшируются при установке Service Worker
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// Внешние домены, которые НИКОГДА не кэшируем (API календаря, заявки, аналитика)
const BYPASS_HOSTS = [
  'script.google.com',
  'script.googleusercontent.com',
  'mc.yandex.ru',
  'mc.yandex.com',
  'api.telegram.org',
  'vk.com',
  'unpkg.com'
];

/**
 * Этап установки: мягко кладём базовые файлы в кэш.
 * Используем раздельные запросы, чтобы отсутствие одной из PNG-иконок
 * не сорвало регистрацию всего Service Worker.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            // Если файл (например, PNG-иконка) ещё не загружен в репозиторий — пропускаем
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/**
 * Этап активации: удаляем старые версии кэша и берём управление вкладками.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Обработка сетевых запросов.
 */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Кэшируем только GET-запросы (POST-заявки и отзывы всегда идут напрямую в сеть)
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Пропускаем не-HTTP протоколы (chrome-extension:// и т.п.)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Внешние API (календарь GAS, Метрика и т.д.) всегда идут напрямую в сеть
  if (BYPASS_HOSTS.some((host) => url.hostname.includes(host))) {
    return;
  }

  // 1. Для HTML-страниц (навигации): сначала сеть (Network-First), при офлайне — кэш
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok && url.origin === self.location.origin) {
            const copy = networkRes.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // 2. Для локальных статических файлов (фото блюд img/, иконки, manifest.json):
  //    отдаём быстро из кэша и параллельно обновляем в фоне (Stale-While-Revalidate)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkPromise = fetch(req)
          .then((networkRes) => {
            if (networkRes && networkRes.ok) {
              const copy = networkRes.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return networkRes;
          })
          .catch(() => cached);

        return cached || networkPromise;
      })
    );
  }
});
