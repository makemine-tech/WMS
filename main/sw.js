/* ===========================================================
   픽앤톡 Service Worker
   · 캐싱은 최소 (사이트 자주 업데이트 — stale 회피)
   · FCM 백그라운드 메시지 처리 (notification 페이로드 자동 표시)
   · 알림 클릭 시 픽앤톡 페이지 포커스
=========================================================== */

/* FCM compat SDK 로드 — Service Worker 안에서 사용 가능 */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');
} catch (e) { /* offline 또는 차단된 환경 — 기본 push 만 동작 */ }

/* makechango-wms 프로젝트 설정 */
if (typeof firebase !== 'undefined' && firebase.initializeApp) {
  try {
    firebase.initializeApp({
      apiKey:'AIzaSyAM2t9dvtStrXNam-YAiq19yD8FHwKpPmI',
      authDomain:'makechango-wms.firebaseapp.com',
      databaseURL:'https://makechango-wms-default-rtdb.asia-southeast1.firebasedatabase.app',
      projectId:'makechango-wms',
      storageBucket:'makechango-wms.firebasestorage.app',
      messagingSenderId:'333385336098',
      appId:'1:333385336098:web:94f07492421965ab32917b'
    });
    if (firebase.messaging.isSupported && firebase.messaging.isSupported()) {
      const messaging = firebase.messaging();
      /* notification 페이로드는 FCM SDK 가 자동 표시 → 별도 처리 불필요.
         data-only 메시지는 onBackgroundMessage 가 호출됨 */
      messaging.onBackgroundMessage(function(payload){
        try {
          var n = payload.notification || {};
          var data = payload.data || {};
          var title = n.title || '픽앤톡';
          var opts = {
            body: n.body || '새 작업이 등록되었습니다',
            icon: '/icon.svg',
            badge: '/icon.svg',
            tag: data.tag || 'picktalk',
            data: { url: data.url || '/picktalk.html', logId: data.logId || null, gid: data.gid || null }
          };
          self.registration.showNotification(title, opts).then(updateAppBadge);
        } catch(e) { /* swallow */ }
      });
    }
  } catch (e) { /* init 실패 → fallback push 핸들러만 동작 */ }
}

/* 활성 알림 수로 앱 배지 갱신 — iOS PWA 16.4+ / Android Chrome */
function updateAppBadge(){
  try {
    if (!('setAppBadge' in self.navigator)) return;
    self.registration.getNotifications().then(function(ns){
      var n = ns.length;
      if (n > 0) self.navigator.setAppBadge(n).catch(function(){});
      else self.navigator.clearAppBadge && self.navigator.clearAppBadge().catch(function(){});
    });
  } catch(e){}
}

self.addEventListener('install', function(e){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil(self.clients.claim());
});

/* fetch — HTML/JS 는 network-first, 정적 자원은 cache-first */
self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (/\.(html|js)$/.test(url.pathname) || url.pathname === '/') {
    e.respondWith(fetch(e.request).catch(function(){ return caches.match(e.request); }));
    return;
  }
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

/* generic web push (FCM 외 / 백업) */
self.addEventListener('push', function(e){
  /* FCM 의 notification 페이로드는 SDK 가 처리하므로 여기 안 옴.
     data-only 또는 비FCM 페이로드만 도달 */
  if (!e.data) return;
  var data = {};
  try { data = e.data.json(); } catch(err) { data = { body: e.data.text() }; }
  /* FCM SDK 가 이미 처리한 경우엔 무시 (중복 표시 방지) — FCM SDK 가 자동 표시한 알림은 self.registration.getNotifications() 로 확인 가능하나, 신뢰성 위해 노티 데이터에 fcm 식별자가 없을 때만 표시 */
  if (data && data.from) return; /* FCM message — SDK 처리 */
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
  var fullUrl = (new URL(url, 'https://makewon.com/')).toString();
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(clients){
      for (var i=0;i<clients.length;i++){
        var c = clients[i];
        if (c.url.indexOf('picktalk') !== -1 && 'focus' in c) {
          c.focus();
          if ('navigate' in c) try { c.navigate(url); } catch(e){}
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
