/* ============================================================
   모든 페이지 카피라이트 (대표님 2026-10-24) — Makemine Design
   - <meta name="copyright"> 가 없으면 넣음
   - 화면 글자에 「Makemine Design」 이 없으면 맨 아래에 작게 한 줄 붙임 (이미 있는 페이지는 그대로)
   각 페이지 </body> 앞에 <script src="/mm_copy.js" defer></script>
============================================================ */
(function(){
  var T = '© 2026 Makemine Design. All rights reserved.';
  function go(){
    if (!document.querySelector('meta[name="copyright"]')){
      var m = document.createElement('meta'); m.name = 'copyright'; m.content = T; document.head.appendChild(m);
    }
    if (!document.body || document.getElementById('mmCopy') || /makemine\s*design/i.test(document.body.innerText || '')) return;
    var d = document.createElement('div'); d.id = 'mmCopy'; d.textContent = T;
    d.style.cssText = 'clear:both;text-align:center;font-size:11px;line-height:1.5;padding:14px 12px calc(14px + env(safe-area-inset-bottom));opacity:.55;color:inherit;font-family:inherit';
    document.body.appendChild(d);
  }
  /* 화면을 스크립트로 늦게 그리는 페이지가 많아서, 다 뜬 뒤 조금 기다렸다가 확인 */
  function later(){ setTimeout(go, 800); }
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
})();
