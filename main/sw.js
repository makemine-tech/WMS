/* ===========================================================
   픽앤톡 Service Worker — minimal
   · 사이트가 자주 업데이트되므로 캐싱은 최소화 (stale 회피)
   · 푸시·알림 클릭 핸들러는 FCM 연동 시 활용
=========================================================== */
self.addEventListener('install', function(e){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(self.clients.claim());
});

/* 네트워크 우선 — 캐시는 fallback */
self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  /* HTML/JS 는 항상 network-first */
  var url = new URL(e.request.url);
  if (/\.(html|js)$/.test(url.pathname) || url.pathname === '/') {
    e.respondWith(fetch(e.request).catch(function(){
      return caches.match(e.request);
    }));
    return;
  }
  /* 정적 자원 (icon, manifest) 은 cache-first */
  if (/\.(svg|png|jpg|jpeg|webp|json)$/.test(url.pathname)) {
    e.respondWith(
      caches.open('picktalk-static-v1').then(function(cache){
        return cache.match(e.request).then(function(hit){
          if (hit) return hit;
          return fetch(e.request).then(function(res){
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          });
        });
      })
    );
  }
});

/* ─── 푸시 알림 (FCM 또는 Web Push 페이로드) ───
   · data.title, data.body, data.url 형식 권장
   · 추후 Cloud Functions 가 새 로그 등록 시 호출 */
self.addEventListener('push', function(e){
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) { data = { body: e.data && e.data.text() }; }
  var title = data.title || '픽앤톡';
  var opts = {
    body: data.body || '새 작업이 등록되었습니다',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'picktalk',
    data: { url: data.url || '/picktalk.html', logId: data.logId || null },
    vibrate: [120, 60, 120]
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/picktalk.html';
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(clients){
      for (var i=0;i<clients.length;i++){
        var c = clients[i];
        if (c.url.indexOf('picktalk') !== -1 && 'focus' in c) {
          c.focus();
          if ('navigate' in c) c.navigate(url);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
