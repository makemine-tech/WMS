/* ═══ 메뉴 모션 설명 재생기 (대표님 2026-10-25) ═══
   메인 전광판 뒷면 패널을 누르면 뜨는 짧은 모션그래픽 — 멜론 광고식 키네틱 타이포 템포(0.4~0.5초 단위 글자 바뀜)
   항상 「MAKECHANGO + 메뉴 이름」으로 시작 → 대표 기능 과장해서 입체로 → 나머지 기능 체크리스트 → 로그인 유도
   → 「메이크창고 / DEV. 메이크마인디자인」으로 끝.
   메뉴 추가: SCENES[key] = { len: 전체 ms, run: function(R){ ... } } */
(function(){
  var NAVY = '#07101f', BLUE = '#4cc9ff', ORANGE = '#ff9a3c', WHITE = '#f4f7fb', RED = '#ff4d5e', YEL = '#ffd23f';

  var CSS = `
.mm-stage{position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:10px;background:${NAVY};container-type:inline-size;
  font-family:'Noto Sans KR','Outfit',system-ui,sans-serif;color:#fff;user-select:none;transition:background .16s}
.mm-l{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.mm-hv{font-family:'Black Han Sans','Noto Sans KR',sans-serif;font-weight:400;letter-spacing:-.02em;line-height:1}
.mm-big{font-size:12.5cqw}
.mm-mid{font-size:7.2cqw}
.mm-ch{display:inline-block}
.mm-line{height:.35cqw;width:0;background:currentColor;margin:2.2cqw 0 2cqw;border-radius:1cqw}
.mm-cap{position:absolute;left:5cqw;bottom:5.5cqw;font-size:5cqw;line-height:1.12;text-shadow:0 .4cqw 2cqw rgba(0,0,0,.65);text-align:left}
.mm-cap em,.mm-em{font-style:normal;color:${ORANGE}}
.mm-top{position:absolute;left:5cqw;top:5cqw;font-size:4.6cqw}
.mm-tag{display:inline-block;font-weight:800;font-size:1.9cqw;letter-spacing:.12em;padding:.6cqw 1.6cqw;border:.25cqw solid currentColor;border-radius:99px;margin:0 .6cqw}
.mm-mono{font-family:'Share Tech Mono',monospace;letter-spacing:.3em}
/* 입체 창고 — 원근 없는 아이소메트릭 */
.mm-iso{position:absolute;left:50%;top:44%;transform-style:preserve-3d}
.mm-floor{position:absolute;transform-style:preserve-3d;border-radius:.6cqw;
  background:#0d2347;box-shadow:0 0 0 .3cqw ${BLUE}55,0 0 6cqw ${BLUE}33;
  background-image:linear-gradient(${BLUE}40 .15cqw,transparent .15cqw),linear-gradient(90deg,${BLUE}40 .15cqw,transparent .15cqw)}
.mm-lb{position:absolute;font-family:'Share Tech Mono',monospace;font-size:1.4cqw;color:${BLUE};opacity:.85}
.mm-pal{position:absolute;transform-style:preserve-3d}
.mm-pal i{position:absolute;display:block}
.mm-pal .t{inset:0;background:#f1c98a;box-shadow:inset 0 0 0 .2cqw #00000022;transition:background .25s}
.mm-pal .t::after{content:'';position:absolute;left:44%;top:0;bottom:0;width:12%;background:#00000018}
.mm-pal .s{left:0;bottom:0;width:100%;transform-origin:50% 100%;transform:rotateX(-90deg);background:#d79a52;transition:background .25s}
.mm-pal .w{left:0;top:0;height:100%;transform-origin:0 50%;transform:rotateY(-90deg);background:#b8783a;transition:background .25s}
.mm-pal.hot .t{background:${ORANGE}} .mm-pal.hot .s{background:#e07a1f} .mm-pal.hot .w{background:#b85e10}
.mm-pal.red .t{background:${RED}} .mm-pal.red .s{background:#d63445} .mm-pal.red .w{background:#a8222f}
.mm-pal.yel .t{background:${YEL}} .mm-pal.yel .s{background:#e0b21c} .mm-pal.yel .w{background:#b38c10}
.mm-target{position:absolute;border:.3cqw dashed ${ORANGE};border-radius:.4cqw}
/* 기기 */
.mm-dev{position:absolute;border:.45cqw solid #cfe6ff;border-radius:1.4cqw;background:#0d2347;display:grid;gap:.5cqw;padding:1.4cqw}
.mm-dev b{display:block;border-radius:.3cqw;background:#ffffff1c;transition:background .2s,box-shadow .2s}
.mm-dev b.on{background:${ORANGE};box-shadow:0 0 2cqw ${ORANGE}}
.mm-base{position:absolute;height:1.2cqw;background:#cfe6ff;border-radius:0 0 1.5cqw 1.5cqw}
.mm-dot{position:absolute;width:1.4cqw;height:1.4cqw;border-radius:50%;background:${ORANGE};box-shadow:0 0 1.6cqw ${ORANGE}}
.mm-rip{position:absolute;width:4cqw;height:4cqw;border-radius:50%;border:.4cqw solid ${ORANGE}}
/* 체크리스트 */
.mm-list{position:absolute;left:5cqw;right:5cqw;top:17cqw;display:grid;grid-template-columns:1fr 1fr;gap:1.5cqw 4cqw}
.mm-it{display:flex;align-items:center;gap:1.6cqw;font-weight:900;font-size:2.9cqw;color:${NAVY};letter-spacing:-.02em}
.mm-box{width:3.4cqw;height:3.4cqw;border:.4cqw solid ${NAVY};border-radius:.6cqw;position:relative;flex-shrink:0}
.mm-box::after{content:'✓';position:absolute;inset:-1.4cqw 0 0 .3cqw;font-size:4.6cqw;font-weight:900;color:${ORANGE};transform:scale(0);transition:transform .18s cubic-bezier(.3,1.8,.5,1)}
.mm-it.ok .mm-box::after{transform:scale(1)}
/* 문 */
.mm-door{position:absolute;top:0;bottom:0;width:50%;background:#0d2347;
  background-image:repeating-linear-gradient(0deg,#ffffff10 0 .3cqw,transparent .3cqw 3cqw)}
.mm-door.l{left:0;box-shadow:inset -.4cqw 0 0 ${BLUE}} .mm-door.r{right:0;box-shadow:inset .4cqw 0 0 ${BLUE}}
.mm-light{position:absolute;inset:0;background:radial-gradient(ellipse at center,#fff 0%,${BLUE} 35%,${NAVY} 75%)}
.mm-ph{display:flex;align-items:center;height:100%;white-space:nowrap}
.mm-ph span{font-family:'Black Han Sans',sans-serif;font-size:6cqw;color:#ffb35c;text-shadow:0 0 1.5cqw rgba(255,150,40,.7);padding-left:100%;animation:mm-marq 7s linear infinite}
@keyframes mm-marq{to{transform:translateX(-100%)}}
`;

  var ready = false;
  function setup(){
    if (ready) return; ready = true;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var lk = document.createElement('link'); lk.rel = 'stylesheet';
    lk.href = 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@700;900&display=swap';
    document.head.appendChild(lk);
  }

  function h(tag, cls, html, parent){
    var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e); return e;
  }
  /* 툭 튀어나오기 / 확 사라지기 */
  function pop(e, d){ return e.animate([{transform:'scale(.35)', opacity:0, filter:'blur(1cqw)'}, {transform:'scale(1.1)', opacity:1, filter:'blur(0)', offset:.7}, {transform:'scale(1)', opacity:1}],
    {duration:380, delay:d || 0, easing:'cubic-bezier(.2,.9,.3,1.3)', fill:'both'}); }
  function slideUp(e, d){ return e.animate([{transform:'translateY(60%)', opacity:0}, {transform:'none', opacity:1}], {duration:300, delay:d || 0, easing:'cubic-bezier(.2,.9,.3,1.2)', fill:'both'}); }
  function blast(e){ var a = e.animate([{opacity:1, transform:'none'}, {opacity:0, transform:'scale(1.5)', filter:'blur(1.2cqw)'}], {duration:240, easing:'ease-in', fill:'forwards'});
    a.onfinish = function(){ e.remove(); }; }
  function shake(e){ e.animate([{transform:'translateX(0)'}, {transform:'translateX(-3%) rotate(-3deg)'}, {transform:'translateX(3%) rotate(3deg)'}, {transform:'translateX(-2%)'}, {transform:'none'}], {duration:300}); }

  /* 한 번 재생 = Run: 타이머 묶음. 멈추면 전부 취소 */
  var cur = null;
  function Run(stage){ this.st = stage; this.tm = []; this.W = stage.clientWidth / 100; this.t0 = performance.now(); }
  /* ms = 재생 시작부터의 시각 (장면 안에서 예약해도 기준은 시작) */
  Run.prototype.at = function(ms, fn){ var self = this; this.tm.push(setTimeout(function(){ if (cur === self) fn(); }, Math.max(0, ms - (performance.now() - this.t0)))); };
  Run.prototype.layer = function(bg){
    var self = this;
    [].slice.call(this.st.querySelectorAll('.mm-l')).forEach(function(o){ blast(o); });
    if (bg) this.st.style.background = bg;
    return h('div', 'mm-l', null, this.st);
  };
  Run.prototype.stop = function(){ this.tm.forEach(clearTimeout); };

  /* 장면을 base 시각에 맞춰 예약하는 도우미 */
  function scene(R, base, fn){ R.at(base, function(){ fn(function(ms, f){ R.at(base + ms, f); }); }); }

  /* ── 공통: 시작 「MAKECHANGO / 메뉴 이름」 ── */
  function intro(R, base, title, color){
    scene(R, base, function(T){
      var L = R.layer(NAVY);
      var w = h('div', 'mm-hv mm-big', null, L);
      'MAKECHANGO'.split('').forEach(function(c, i){
        var s = h('span', 'mm-ch', c, w);
        s.animate([{transform:'translateY(-140%) rotate(-14deg)', opacity:0}, {transform:'translateY(10%)', opacity:1, offset:.75}, {transform:'none', opacity:1}],
          {duration:420, delay:i * 55, easing:'cubic-bezier(.3,1.4,.5,1)', fill:'both'});
      });
      var ln = h('div', 'mm-line', null, L); ln.style.color = color;
      ln.animate([{width:'0'}, {width:'46cqw'}], {duration:380, delay:750, easing:'cubic-bezier(.6,0,.2,1)', fill:'forwards'});
      var k = h('div', 'mm-hv mm-mid', title, L); k.style.color = color; pop(k, 1000);
    });
  }

  /* ── 공통: 끝 「메이크창고 / DEV. 메이크마인디자인」 ── */
  function outro(R, base){
    scene(R, base, function(T){
      var L = R.layer(NAVY);
      var w = h('div', 'mm-hv mm-big', null, L);
      '메이크창고'.split('').forEach(function(c, i){
        var s = h('span', 'mm-ch', c, w);
        s.animate([{transform:'translateY(50%) scale(.6)', opacity:0}, {transform:'none', opacity:1}], {duration:360, delay:i * 70, easing:'cubic-bezier(.2,.9,.3,1.3)', fill:'both'});
      });
      var ln = h('div', 'mm-line', null, L); ln.style.color = BLUE;
      ln.animate([{width:'0'}, {width:'30cqw'}], {duration:420, delay:550, easing:'cubic-bezier(.6,0,.2,1)', fill:'forwards'});
      var d = h('div', 'mm-mono', 'DEV. <b style="font-family:\'Noto Sans KR\',sans-serif;letter-spacing:.05em">메이크마인디자인</b>', L);
      d.style.cssText = 'font-size:2.6cqw;color:' + BLUE; slideUp(d, 850);
      var m = h('div', 'mm-mono', 'MAKEMINE DESIGN · MAKECHANGO', L);
      m.style.cssText = 'font-size:1.4cqw;opacity:.45;margin-top:1.4cqw'; slideUp(m, 1050);
    });
  }

  /* 빠른 단어 바꿈: [[글자, 바탕, 글자색], …] 한 단어당 step ms */
  function words(R, base, list, step){
    list.forEach(function(x, i){
      R.at(base + i * step, function(){
        var L = R.layer(x[1]);
        var e = h('div', 'mm-hv ' + (x[3] || 'mm-big'), x[0], L); e.style.color = x[2];
        pop(e); if (x[4]) R.at(base + i * step + 200, function(){ shake(e); });
      });
    });
  }

  /* ═══ 창고관리 (wms) ═══ 약 24초 */
  function wms(R){
    intro(R, 0, '창고관리', BLUE);

    words(R, 2500, [['창고가', NAVY, '#fff'], ['한눈에', BLUE, NAVY], ['보인다?', NAVY, '#fff'], ['보인다!!', ORANGE, NAVY, 0, true]], 470);

    /* 입체 창고 — 파렛트가 칸칸이 떨어지고, 하나 옮기고, 유통기한 색 */
    scene(R, 4500, function(T){
      var L = R.layer('radial-gradient(ellipse at 50% 40%,#123066 0%,' + NAVY + ' 70%)');
      var px = R.W, COLS = 6, ROWS = 4, C = 7.2 * px, H = 4.2 * px;
      var iso = h('div', 'mm-iso', null, L);
      var fl = h('div', 'mm-floor', null, iso);
      fl.style.cssText = 'width:' + COLS * C + 'px;height:' + ROWS * C + 'px;left:' + (-COLS * C / 2) + 'px;top:' + (-ROWS * C / 2) + 'px;background-size:' + C + 'px ' + C + 'px';
      'ABCD'.split('').forEach(function(r, i){ var lb = h('div', 'mm-lb', r, fl); lb.style.cssText = 'left:' + (-2.2 * px) + 'px;top:' + (i * C + C * .35) + 'px'; });
      for (var c = 0; c < COLS; c++){ var lb = h('div', 'mm-lb', String(c + 1), fl); lb.style.cssText = 'top:' + (-2.4 * px) + 'px;left:' + (c * C + C * .42) + 'px'; }
      /* 주의: 입체 묶음(.mm-iso·.mm-pal)에 opacity 애니메이션을 걸면 크롬이 납작하게 눌러 버림 → 크기·visibility 로만 */
      iso.animate([{transform:'rotateX(58deg) rotateZ(-225deg) scale(.05)'}, {transform:'rotateX(58deg) rotateZ(-45deg) scale(1)'}],
        {duration:700, easing:'cubic-bezier(.2,.8,.2,1)', fill:'both'});
      var FILL = ['0,0','1,0','2,0','4,0','5,0','0,1','1,1','3,1','4,1','0,2','2,2','3,2','5,2','1,3','2,3','3,3','4,3'];
      var pals = {};
      FILL.forEach(function(k, i){
        var cc = +k.split(',')[0], rr = +k.split(',')[1];
        var p = h('div', 'mm-pal', '<i class="t"></i><i class="s"></i><i class="w"></i>', fl);
        p.style.cssText = 'left:' + (cc * C + C * .12) + 'px;top:' + (rr * C + C * .12) + 'px;width:' + C * .76 + 'px;height:' + C * .76 + 'px';
        p.querySelector('.t').style.transform = 'translateZ(' + H + 'px)';
        p.querySelector('.s').style.height = H + 'px';
        p.querySelector('.w').style.width = H + 'px';
        p.style.visibility = 'hidden';
        p.animate([{transform:'translateZ(' + 30 * px + 'px)', visibility:'visible'}, {transform:'translateZ(0)', visibility:'visible', offset:.8}, {transform:'translateZ(' + px + 'px)', visibility:'visible', offset:.9}, {transform:'translateZ(0)', visibility:'visible'}],
          {duration:420, delay:500 + (cc + rr) * 75, easing:'cubic-bezier(.55,0,.8,.6)', fill:'forwards'});
        pals[k] = p;
      });
      var cap = h('div', 'mm-cap mm-hv', '', L);
      function say(t){ cap.innerHTML = t; slideUp(cap); }
      T(350, function(){ say('창고 로케이션,'); });
      T(1250, function(){ say('<em>칸칸이 전부</em> 관리'); });
      /* 하나 옮기기 */
      T(2300, function(){
        say('옮길 땐?<br><em>끌어다 놓으면 끝</em>');
        var p = pals['1,1']; p.classList.add('hot');
        var tg = h('div', 'mm-target', null, fl);
        tg.style.cssText = 'left:' + (5 * C + C * .08) + 'px;top:' + (3 * C + C * .08) + 'px;width:' + C * .84 + 'px;height:' + C * .84 + 'px';
        pop(tg);
        var a = { l:(1 * C + C * .12) + 'px', t:(1 * C + C * .12) + 'px' }, b = { l:(5 * C + C * .12) + 'px', t:(3 * C + C * .12) + 'px' };
        p.animate([
          {left:a.l, top:a.t, transform:'translateZ(0)'},
          {left:a.l, top:a.t, transform:'translateZ(' + 2.4 * H + 'px)', offset:.22},
          {left:b.l, top:b.t, transform:'translateZ(' + 2.4 * H + 'px)', offset:.78},
          {left:b.l, top:b.t, transform:'translateZ(0)'}], {duration:1000, delay:250, easing:'ease-in-out', fill:'forwards'});
        R.at(4500 + 2300 + 1300, function(){ tg.remove(); p.classList.remove('hot'); });
      });
      /* 유통기한 색 */
      T(3900, function(){
        say('유통기한 임박?<br><em>색깔이 먼저 일러줌</em> 🚨');
        [['0,0','red'],['3,2','red'],['4,3','yel'],['2,0','yel'],['0,2','yel']].forEach(function(x, i){
          var p = pals[x[0]];
          R.at(4500 + 3900 + i * 130, function(){
            p.classList.add(x[1]);
            p.animate([{transform:'translateZ(0)'}, {transform:'translateZ(' + 1.6 * px + 'px)'}, {transform:'translateZ(0)'}], {duration:260, iterations:3});
          });
        });
      });
    });

    /* 실시간 동기화 — 폰에서 넣으면 PC에 바로 */
    scene(R, 10400, function(T){
      var L = R.layer('#0b1a33'), px = R.W;
      function grid(dev, cols, rows){ dev.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)'; var bs = []; for (var i = 0; i < cols * rows; i++) bs.push(h('b', null, null, dev)); return bs; }
      var ph = h('div', 'mm-dev', null, L); ph.style.cssText = 'left:12cqw;top:15cqw;width:15cqw;height:28cqw;border-radius:2.2cqw';
      var pb = grid(ph, 3, 6);
      var pc = h('div', 'mm-dev', null, L); pc.style.cssText = 'right:10cqw;top:14cqw;width:42cqw;height:25cqw';
      var cb = grid(pc, 6, 4);
      var base = h('div', 'mm-base', null, L); base.style.cssText = 'right:7cqw;top:39.8cqw;width:48cqw';
      pop(ph); pop(pc, 120); pop(base, 160);
      var cap = h('div', 'mm-top mm-hv', '', L);
      T(500, function(){ cap.innerHTML = '폰에서 찍으면,'; slideUp(cap);
        var r = h('div', 'mm-rip', null, L); r.style.cssText = 'left:17.5cqw;top:25cqw';
        r.animate([{transform:'scale(.2)', opacity:1}, {transform:'scale(1.8)', opacity:0}], {duration:500, iterations:2});
        pb[7].classList.add('on'); });
      T(1000, function(){
        for (var i = 0; i < 4; i++){ var d = h('div', 'mm-dot', null, L); d.style.cssText = 'left:22cqw;top:26cqw';
          d.animate([{transform:'translate(0,0) scale(.6)', opacity:0}, {transform:'translate(' + 16 * px + 'px,' + (-10 * px) + 'px) scale(1)', opacity:1, offset:.5}, {transform:'translate(' + 36 * px + 'px,' + (-1 * px) + 'px) scale(.6)', opacity:0}],
            {duration:520, delay:i * 90, easing:'ease-in-out', fill:'both'}); }
      });
      T(1500, function(){ cb[9].classList.add('on'); pop(cb[9]); cap.innerHTML = 'PC에 <span class="mm-em">바로</span> 뜬다'; slideUp(cap); });
      T(2100, function(){
        var tg = h('div', null, null, L); tg.style.cssText = 'position:absolute;left:0;right:0;bottom:4.5cqw;text-align:center';
        ['실시간 동기화', '설치 없음', '폰·태블릿·PC'].forEach(function(t, i){ var s = h('span', 'mm-tag', t, tg); s.style.color = i === 0 ? ORANGE : BLUE; pop(s, i * 110); });
      });
    });

    /* 체크리스트 — 흰 바탕으로 확 바뀜 */
    scene(R, 13600, function(T){
      var L = R.layer(WHITE);
      var t = h('div', 'mm-top mm-hv', '그리고 또,', L); t.style.cssText += ';color:' + NAVY + ';font-size:5.4cqw'; pop(t);
      var box = h('div', 'mm-list', null, L);
      var ITEMS = ['입고 자동 배치', '출고대기 예약 · 확정', '바로출고', '되돌리기 (Undo)', '작업 히스토리 기록', '엑셀 · 구글시트 내보내기',
        '공지 메모', '업체별 재고 보고서', '그룹 · 권한 관리', '파렛트 일괄 수정'];
      ITEMS.forEach(function(s, i){
        var it = h('div', 'mm-it', '<span class="mm-box"></span>' + s, box);
        slideUp(it, 300 + i * 210);
        T(450 + i * 210, function(){ it.classList.add('ok'); });
      });
      T(2900, function(){
        var e = h('div', 'mm-hv', '…더 있음. <span class="mm-em">진짜로.</span>', L);
        e.style.cssText = 'position:absolute;right:5cqw;bottom:4.5cqw;font-size:4cqw;color:' + NAVY; pop(e);
      });
    });

    /* 로그인 유도 — 문이 열린다 */
    words(R, 17600, [['이건 맛보기.', NAVY, '#fff', 'mm-mid'], ['로그인하면,', BLUE, NAVY, 'mm-mid']], 650);
    scene(R, 18900, function(T){
      var L = R.layer(NAVY);
      var lt = h('div', 'mm-light', null, L);
      var tx = h('div', 'mm-hv mm-mid', '창고가 열립니다', L); tx.style.cssText = 'position:relative;color:' + NAVY;
      var dl = h('div', 'mm-door l', null, L), dr = h('div', 'mm-door r', null, L);
      dl.animate([{transform:'none'}, {transform:'translateX(-100%)'}], {duration:700, delay:350, easing:'cubic-bezier(.7,0,.2,1)', fill:'forwards'});
      dr.animate([{transform:'none'}, {transform:'translateX(100%)'}], {duration:700, delay:350, easing:'cubic-bezier(.7,0,.2,1)', fill:'forwards'});
      lt.animate([{opacity:.3}, {opacity:1}], {duration:900, delay:300, fill:'both'});
      pop(tx, 700);
    });

    outro(R, 21000);
  }

  var SCENES = {
    wms: { len: 25000, run: wms }
  };

  window.MCMotion = {
    has: function(key){ return !!SCENES[key]; },
    /* stage 에 key 장면 재생. 끝나면 onEnd. 없는 메뉴면 이름 흐르는 자리표시 */
    play: function(key, stage, name, onEnd){
      setup(); this.stop();
      stage.className = 'mm-stage'; stage.innerHTML = ''; stage.style.background = '';
      var R = cur = new Run(stage);
      if (!SCENES[key]){
        stage.innerHTML = '<div class="mm-ph"><span>▶ ' + (name || '') + ' · 모션 설명 준비 중 ·</span></div>';
        return 0;
      }
      SCENES[key].run(R);
      R.at(SCENES[key].len, function(){ if (onEnd) onEnd(); });
      return SCENES[key].len;
    },
    stop: function(){ if (cur) cur.stop(); cur = null; }
  };
})();
