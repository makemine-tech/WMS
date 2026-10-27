/* 이지어드민 송장 흐름 메뉴 — 일괄합포제외(ez_split) · 업로드 · 피킹리스트 · 그룹 인쇄(picking_ez) 공용
   두 페이지 맨 위에 같은 폭(1180px)으로 고정. 상태줄 = ☁ 실시간 연동 · 🔌 이지어드민 도우미
   도우미 상태는 ez_split 이 localStorage ezHelperState 에 5초마다 남기고, picking_ez 는 그걸 읽어 표시 */
(function(){
  var STEPS = [
    { n: 1, t: '일괄합포제외', s: '필요할 때만' },
    { n: 2, t: '송장 업로드', s: '자동수집 · PDF' },
    { n: 3, t: '피킹리스트', s: '' },
    { n: 4, t: '그룹 인쇄', s: '' }
  ];
  /* 상단바 — 두 페이지 같은 모양 (예전 picking_ez 머리) */
  var HDR = "<div class=\"unified-hdr\" style=\"background:linear-gradient(135deg,#1f2937,#374151);color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;position:relative;z-index:10000;gap:10px;\"><div style=\"display:flex;align-items:center;gap:10px;min-width:0\"><div style=\"width:28px;height:28px;background:rgba(255,255,255,.12);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0\">🚚</div><div style=\"min-width:0\"><div style=\"font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\">이지어드민 피킹 시스템</div><div style=\"font-size:9px;color:rgba(255,255,255,.45);letter-spacing:.06em;white-space:nowrap\">EZ-ADMIN PICKING SYSTEM v1</div></div></div><a href=\"https://makewon.com/\" class=\"hdr-home-btn\" rel=\"noopener\" aria-label=\"MAKEWON.COM 홈으로\"><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 11.5L12 4l9 7.5\"/><path d=\"M5 10v10a1 1 0 0 0 1 1h4v-7h4v7h4a1 1 0 0 0 1-1V10\"/></svg><span class=\"hdr-home-txt\">MAKEWON.COM</span></a></div>";
  var HELPER_KEY = 'ezHelperState', FRESH_MS = 15000;
  var css = ''
    + '.ez-flow{position:sticky;top:0;z-index:9000;background:rgba(13,15,20,.96);backdrop-filter:blur(6px);border-bottom:1px solid #2a2f3d;padding:.45rem 1rem .4rem}'
    + '.ez-flow-in{max-width:1180px;margin:0 auto}'
    + '.ez-flow-st{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #2a2f3d;border-radius:9px;overflow:hidden}'
    + '.ez-flow-st a{display:block;text-decoration:none;text-align:center;padding:.42rem .3rem;color:#7c8399;background:#151820;border-right:1px solid #2a2f3d;font:700 .78rem "Malgun Gothic","Noto Sans KR",sans-serif;cursor:pointer;transition:background .15s}'
    + '.ez-flow-st a:last-child{border-right:none}'
    + '.ez-flow-st a:hover{background:rgba(74,240,168,.1);color:#4af0a8}'
    + '.ez-flow-st a i{display:block;font:normal .56rem "Courier New",monospace;opacity:.65;margin-bottom:.05rem;letter-spacing:.06em}'
    + '.ez-flow-st a em{display:block;font-style:normal;font-weight:400;font-size:.6rem;opacity:.6}'
    + '.ez-flow-st a.s1{color:#f0a84a}'
    + '.ez-flow-st a.on{background:rgba(74,240,168,.14);color:#4af0a8;box-shadow:inset 0 -3px 0 #4af0a8}'
    + '.ez-flow-st a.s1.on{background:rgba(240,168,74,.14);color:#f0a84a;box-shadow:inset 0 -3px 0 #f0a84a}'
    + '.ez-flow-st a.done{color:#4af0a8}'
    + '.ez-flow-stat{display:flex;justify-content:center;gap:1.1rem;flex-wrap:wrap;margin-top:.3rem;font:.68rem "Courier New",monospace;color:#7c8399}'
    + '.ez-flow-stat span{white-space:nowrap}'
    + '.ez-flow-stat .ezf-ok{color:#4af0a8}.ez-flow-stat .ezf-warn{color:#f0c44a}.ez-flow-stat .ezf-er{color:#f05858}'
    + '.hdr-home-btn{display:inline-flex;align-items:center;gap:5px;text-decoration:none;color:rgba(255,255,255,.72);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;padding:5px 11px;border:1px solid rgba(255,255,255,.22);border-radius:999px;transition:color .2s,border-color .2s,background .2s;flex-shrink:0;line-height:1;white-space:nowrap}'
    + '.hdr-home-btn:hover{color:#fff;border-color:rgba(255,255,255,.55);background:rgba(255,255,255,.08)}'
    + '.hdr-home-btn svg{opacity:.7}.hdr-home-btn:hover svg{opacity:1}'
    + '@media(max-width:380px){.hdr-home-txt{display:none}.hdr-home-btn{padding:5px 8px}}'
    + '.mw-home-fab{display:none!important}a.btn-home,a.home-btn,a.home-link,.btn-home,.home-btn,.home-link{display:none!important}'
    + '.unified-hdr *{box-sizing:border-box}'
    + '.unified-hdr,.ez-flow{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.5;margin:0}'
    + '.wz-next{display:block;width:100%;box-sizing:border-box;margin:1.1rem 0 .4rem;padding:1rem 1.2rem;border-radius:11px;border:1.5px solid #4af0a8;background:transparent;color:#4af0a8;'
    +   'font:800 1.02rem "Malgun Gothic","Noto Sans KR",sans-serif;text-align:center;text-decoration:none;cursor:pointer;transition:.15s}'
    + '.wz-next:hover{background:rgba(74,240,168,.1)}'
    + '.wz-next.go{background:#4af0a8;color:#0d0f14;box-shadow:0 6px 24px rgba(74,240,168,.3)}'
    + '.wz-next.go:hover{background:#6affc0}'
    + '.wz-next small{display:block;font-weight:400;font-size:.7rem;opacity:.75;margin-top:.15rem}'
    + '@media(max-width:640px){.ez-flow-st a{font-size:.68rem;padding:.35rem .15rem}.ez-flow-st a em{display:none}}'
    + '@media print{.ez-flow,.wz-next,.unified-hdr{display:none!important}}';

  var root, opts, links = [];
  function el(tag, cls, html){ var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* o: { page:'split'|'pick', step:1~4, go:function(n) (pick 페이지 안에서 2~4 이동) } */
  function mount(o){
    opts = o || {};
    if (!document.getElementById('ezFlowCss')) { var st = el('style'); st.id = 'ezFlowCss'; st.textContent = css; document.head.appendChild(st); }
    root = el('div', 'ez-flow');
    var inner = el('div', 'ez-flow-in'), bar = el('div', 'ez-flow-st');
    STEPS.forEach(function(s){
      var a = el('a', 's' + s.n, '<i>STEP ' + s.n + '</i>' + s.t + (s.s ? '<em>' + s.s + '</em>' : ''));
      a.href = s.n === 1 ? 'ez_split.html' : 'picking_ez.html?step=' + s.n;
      a.onclick = function(e){
        if (opts.page === 'pick' && s.n > 1 && opts.go) { e.preventDefault(); opts.go(s.n); }
        else if (opts.page === 'split' && s.n === 1) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      };
      links[s.n] = a; bar.appendChild(a);
    });
    var stat = el('div', 'ez-flow-stat',
      '<span id="ezfSync">☁ 실시간 연동 확인 중…</span><span id="ezfHelper">🔌 이지어드민 도우미 연결 안 됨</span>');
    inner.appendChild(bar); inner.appendChild(stat); root.appendChild(inner);
    /* 상단바 + 흐름 메뉴를 body 맨 앞에 — 어느 페이지든 같은 자리 */
    var hold = el('div'); hold.innerHTML = HDR;
    var hdr = hold.firstChild;
    document.body.insertBefore(root, document.body.firstChild);
    document.body.insertBefore(hdr, root);
    setStep(opts.step || 1);
    watchSync();
    if (opts.page === 'pick') { readHelper(); setInterval(readHelper, 5000); window.addEventListener('storage', function(e){ if (e.key === HELPER_KEY) readHelper(); }); }
  }
  function setStep(n){
    for (var i = 1; i <= 4; i++) if (links[i]) links[i].className = 's' + i + (i === n ? ' on' : (i < n && i > 1 ? ' done' : ''));
  }
  function status(which, kind, text){
    var e = document.getElementById(which === 'helper' ? 'ezfHelper' : 'ezfSync');
    if (!e) return;
    e.className = kind ? 'ezf-' + kind : ''; e.textContent = text;
  }
  /* 실시간 연동 — Firebase 연결 상태 (페이지가 더 자세한 글을 넣으면 그걸로) */
  var syncText = null;
  function watchSync(){
    var tries = 0;
    (function wait(){
      if (window.firebase && firebase.apps && firebase.apps.length && firebase.database) {
        firebase.database().ref('.info/connected').on('value', function(s){
          if (s.val()) status('sync', 'ok', syncText || '☁ 실시간 연동 중');
          else status('sync', 'warn', '☁ 실시간 연동 끊김 — 다시 연결 중…');
        });
        return;
      }
      if (++tries < 40) setTimeout(wait, 500); else status('sync', 'er', '☁ 실시간 연동 안 됨');
    })();
  }
  function syncDetail(kind, text){ syncText = kind === 'ok' ? text : null; status('sync', kind, text); }
  /* 도우미 — ez_split 이 연결 상태를 남김 */
  function putHelper(ok, text){
    try { localStorage.setItem(HELPER_KEY, JSON.stringify({ ok: !!ok, text: text || '', ts: Date.now() })); } catch(e){}
    status('helper', ok ? 'ok' : '', text || (ok ? '🔌 이지어드민 도우미 연결됨' : '🔌 이지어드민 도우미 연결 안 됨'));
  }
  function readHelper(){
    var h = null; try { h = JSON.parse(localStorage.getItem(HELPER_KEY) || 'null'); } catch(e){}
    if (h && h.ok && Date.now() - h.ts < FRESH_MS) status('helper', 'ok', '🔌 이지어드민 도우미 연결됨 (일괄합포제외 창)');
    else status('helper', '', '🔌 이지어드민 도우미 연결 안 됨');
  }
  window.EZ_FLOW = { mount: mount, setStep: setStep, status: status, syncDetail: syncDetail, putHelper: putHelper };
})();
