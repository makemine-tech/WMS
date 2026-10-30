/* ============================================================
   📌 화면 위치 고정 (대표님 2026-10-30 · star_outorder.html 오른쪽 끝 버튼)
   켜면 스크롤(휠·터치·스크롤바·PgUp/PgDn)로만 화면이 움직인다. 버튼·스캔으로 줄이 늘고 줄어도 그대로.
   움직이던 원인 3가지를 모두 막는다:
     ① 위쪽 내용이 늘고 줄어 아래가 밀림 (스캔 안내 문구가 떴다 사라짐 등) → 기준 요소가 화면에서 그 자리에 있도록 그려지기 전에 되돌림
     ② 목록이 줄어 페이지가 짧아져 위로 당겨짐 → 맨 아래에 빈 공간을 잠깐 덧대 길이 유지
     ③ 스캔칸으로 커서가 돌아갈 때 화면이 끌려감 → focus 때 스크롤하지 않음
   켜고 끈 상태는 이 PC 에 기억 (localStorage).
============================================================ */
(function(){
  var KEY = 'starPinOn';
  /* 기준 요소 = 다시 그려지지 않는 틀만, 앞에 있을수록 우선. 화면에 보이는 첫 번째를 기준으로 — 없으면 화면에 가장 가까운 것
     (스캔칸은 맨 뒤: 스캔칸 바로 아래 안내 문구가 뜰 때 작업 버튼이 밀리면 안 되므로) */
  var ANCHORS = ['.cp-staging-actions', '#cpPendingPanel', '.cp-done-pool', '#cpScanInp'];
  var on = false, anchor = null, savedTop = 0, savedY = 0, userUntil = 0, dragging = false, spacerH = 0, raf = 0, btn, spacer;
  var now = function(){ return performance.now(); };

  function rectOf(el){ var r = el.getBoundingClientRect(); return r.height || r.width ? r : null; }
  function pick(){
    var best = null, bs = Infinity;
    ANCHORS.forEach(function(q, i){ var el = document.querySelector(q), r = el && rectOf(el); if (!r) return;
      var s = r.top >= 0 && r.top < window.innerHeight ? i : Math.abs(r.top) + 100000;
      if (s < bs){ bs = s; best = el; } });
    return best;
  }
  /* 덧댄 공간은 지금 위치를 지키는 데 필요한 만큼만 */
  function fitSpacer(){
    var natural = document.documentElement.scrollHeight - spacerH, h = Math.max(0, Math.ceil(window.scrollY + window.innerHeight - natural));
    if (h !== spacerH){ spacerH = h; spacer.style.height = h + 'px'; }
  }
  function rebase(){
    fitSpacer();
    anchor = pick(); savedY = window.scrollY;
    var r = anchor && rectOf(anchor); savedTop = r ? r.top : 0; if (!r) anchor = null;
  }
  function tick(){
    if (!on) return;
    raf = requestAnimationFrame(tick);
    if (window.matchMedia && window.matchMedia('print').matches) return;
    if (dragging || now() < userUntil){ rebase(); return; }
    var r = anchor && anchor.isConnected ? rectOf(anchor) : null;
    if (anchor && !r){ rebase(); return; }
    var d = r ? r.top - savedTop : savedY - window.scrollY;
    if (Math.abs(d) < 1){ fitSpacer(); return; }
    var lack = window.scrollY + d + window.innerHeight - document.documentElement.scrollHeight;
    if (lack > 0){ spacerH += Math.ceil(lack); spacer.style.height = spacerH + 'px'; }
    window.scrollTo({ top: window.scrollY + d, left: window.scrollX, behavior: 'instant' });
    if (window.scrollY <= 0) rebase();   /* 더 올라갈 곳이 없음 — 맨 위에서 다시 기준 */
  }
  function user(ms){ userUntil = Math.max(userUntil, now() + ms); }
  function isEdit(t){ return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }

  /* 사람이 하는 스크롤만 통과 */
  window.addEventListener('wheel', function(){ user(350); }, { passive: true, capture: true });
  window.addEventListener('touchstart', function(){ user(600); }, { passive: true, capture: true });
  window.addEventListener('touchmove', function(){ user(600); }, { passive: true, capture: true });
  window.addEventListener('touchend', function(){ user(600); }, { passive: true, capture: true });
  window.addEventListener('keydown', function(e){ if (!isEdit(e.target) && /^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown| )$/.test(e.key)) user(500); }, true);
  window.addEventListener('pointerdown', function(e){
    if (e.button === 1) user(500);   /* 휠 클릭 자동 스크롤 */
    if (e.target === document.documentElement && e.clientX >= document.documentElement.clientWidth) dragging = true;   /* 스크롤바 */
  }, true);
  window.addEventListener('pointermove', function(e){ if (dragging && !e.buttons){ dragging = false; user(200); } }, true);
  window.addEventListener('pointerup', function(){ if (dragging){ dragging = false; user(200); } }, true);
  window.addEventListener('blur', function(){ if (dragging){ dragging = false; user(200); } });
  window.addEventListener('scroll', function(){ if (dragging || now() < userUntil) user(150); }, { passive: true });   /* 관성 스크롤 끝날 때까지 */
  window.addEventListener('resize', function(){ if (on) user(150); });

  var origFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function(o){ return origFocus.call(this, on ? Object.assign({}, o, { preventScroll: true }) : o); };

  function draw(){
    btn.textContent = on ? '📌 고정 중' : '📌 위치 고정';
    btn.style.background = on ? 'linear-gradient(180deg,#16a34a,#14b8a6)' : '#1c2331';
    btn.style.color = on ? '#fff' : '#a9b4c8';
    btn.style.borderColor = on ? 'rgba(110,240,190,.8)' : '#3a4560';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? '고정 중 — 스크롤할 때만 화면이 움직입니다. 누르면 해제' : '누르면 지금 화면 위치를 고정 — 버튼을 누르거나 스캔해서 줄이 늘고 줄어도 화면이 움직이지 않습니다 (스크롤은 그대로)';
  }
  function set(v){
    on = !!v;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    document.documentElement.style.overflowAnchor = on ? 'none' : '';
    cancelAnimationFrame(raf);
    if (on){ rebase(); raf = requestAnimationFrame(tick); }
    else { spacerH = 0; spacer.style.height = '0'; anchor = null; }
    draw();
  }
  function init(){
    var st = document.createElement('style');
    st.textContent = '#starPinBtn{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:8500;writing-mode:vertical-rl;padding:.7rem .3rem;font-family:inherit;font-size:.78rem;font-weight:800;letter-spacing:.04em;border:1.5px solid;border-right:none;border-radius:9px 0 0 9px;cursor:pointer;box-shadow:-2px 2px 10px rgba(0,0,0,.4)}'
      + '#starPinBtn:hover{filter:brightness(1.15)}#starPinSpacer{flex:none;height:0}'
      + '@media print{#starPinBtn,#starPinSpacer{display:none!important}}';
    document.head.appendChild(st);
    spacer = document.createElement('div'); spacer.id = 'starPinSpacer'; document.body.appendChild(spacer);
    btn = document.createElement('button'); btn.id = 'starPinBtn'; btn.type = 'button';
    btn.addEventListener('mousedown', function(e){ e.preventDefault(); });   /* 스캔칸 커서를 뺏지 않는다 */
    btn.addEventListener('click', function(){ set(!on); });
    document.body.appendChild(btn);
    var saved = false; try { saved = localStorage.getItem(KEY) === '1'; } catch (e) {}
    set(saved);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
