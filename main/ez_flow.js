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
    + '.ez-flow-stat .ok{color:#4af0a8}.ez-flow-stat .warn{color:#f0c44a}.ez-flow-stat .er{color:#f05858}'
    + '.wz-next{display:block;width:100%;box-sizing:border-box;margin:1.1rem 0 .4rem;padding:1rem 1.2rem;border-radius:11px;border:1.5px solid #4af0a8;background:transparent;color:#4af0a8;'
    +   'font:800 1.02rem "Malgun Gothic","Noto Sans KR",sans-serif;text-align:center;text-decoration:none;cursor:pointer;transition:.15s}'
    + '.wz-next:hover{background:rgba(74,240,168,.1)}'
    + '.wz-next.go{background:#4af0a8;color:#0d0f14;box-shadow:0 6px 24px rgba(74,240,168,.3)}'
    + '.wz-next.go:hover{background:#6affc0}'
    + '.wz-next small{display:block;font-weight:400;font-size:.7rem;opacity:.75;margin-top:.15rem}'
    + '@media(max-width:640px){.ez-flow-st a{font-size:.68rem;padding:.35rem .15rem}.ez-flow-st a em{display:none}}'
    + '@media print{.ez-flow,.wz-next{display:none!important}}';

  var root, opts, links = [];
  function el(tag, cls, html){ var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* o: { page:'split'|'pick', step:1~4, go:function(n) (pick 페이지 안에서 2~4 이동), after: 메뉴를 넣을 요소(그 뒤에) } */
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
    var after = opts.after || null;
    if (after && after.parentNode) after.parentNode.insertBefore(root, after.nextSibling);
    else document.body.insertBefore(root, document.body.firstChild);
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
    e.className = kind || ''; e.textContent = text;
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
