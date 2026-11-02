/* 메이크창고 비서 확장 — 비서가 연 탭에만 도우미를 켠다 (북마크로 켜는 것과 같은 스크립트, 2026-11-01)
   window.name 은 헤드비서가 window.open 으로 지은 이름. 직접 연 탭은 이름도 opener 도 없어 켜지지 않는다. */
(function(){
  'use strict';
  var HELPERS = { mkw_sec_ez: { host: /(^|\.)ezadmin\.co\.kr$/, src: 'https://makewon.com/ez_helper.js' },
                  mkw_sec_ebut: { host: /(^|\.)ebut3pl\.co\.kr$/, src: 'https://makewon.com/ebut_helper.js' },
                  mkw_sec_bizem: { host: /(^|\.)bizesm\.com$/, src: 'https://makewon.com/bizem_helper.js' } };
  var h = Object.prototype.hasOwnProperty.call(HELPERS, window.name) ? HELPERS[window.name] : null;
  if (!h || !window.opener || !h.host.test(location.hostname)) return;
  var s = document.createElement('script');
  s.src = h.src + '?v=' + Date.now();
  document.head.appendChild(s);
})();
