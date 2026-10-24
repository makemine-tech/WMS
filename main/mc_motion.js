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
/* 시작 로고 = 홈페이지 메인 로고와 같은 Outfit (MAKE 가늘게 · CHANGO 굵게) / 끝 「메이크창고」 = 가는 한글 */
.mm-logo{font-family:"Outfit",system-ui,sans-serif;font-size:11cqw;line-height:1;letter-spacing:-.03em;white-space:nowrap}
.mm-logo .lt{font-weight:200;color:rgba(255,255,255,.62);letter-spacing:.04em}
.mm-logo .bd{font-weight:900}
.mm-fine{font-family:"Outfit",system-ui,sans-serif;font-weight:100;font-size:8.5cqw;letter-spacing:.22em;margin-right:-.22em;line-height:1}
.mm-hair{height:1px;width:0;background:rgba(255,255,255,.7);margin:2.6cqw 0 2.2cqw}
.mm-thin{font-family:"Noto Sans KR",sans-serif;font-weight:100;font-size:11cqw;letter-spacing:.06em;line-height:1}
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
    lk.href = 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@100;700;900&family=Outfit:wght@100;200;900&display=swap';
    document.head.appendChild(lk);
  }

  function h(tag, cls, html, parent){
    var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e); return e;
  }
  /* 툭 튀어나오기 / 확 사라지기 */
  function pop(e, d){ return e.animate([{transform:'scale(.35)', opacity:0, filter:'blur(1cqw)'}, {transform:'scale(1.1)', opacity:1, filter:'blur(0)', offset:.7}, {transform:'scale(1)', opacity:1}],
    {duration:260, delay:d || 0, easing:'cubic-bezier(.2,.9,.3,1.3)', fill:'both'}); }
  function slideUp(e, d){ return e.animate([{transform:'translateY(60%)', opacity:0}, {transform:'none', opacity:1}], {duration:300, delay:d || 0, easing:'cubic-bezier(.2,.9,.3,1.2)', fill:'both'}); }
  function blast(e){ var a = e.animate([{opacity:1, transform:'none'}, {opacity:0, transform:'scale(1.5)', filter:'blur(1.2cqw)'}], {duration:240, easing:'ease-in', fill:'forwards'});
    a.onfinish = function(){ e.remove(); }; }
  function shake(e){ e.animate([{transform:'translateX(0)'}, {transform:'translateX(-3%) rotate(-3deg)'}, {transform:'translateX(3%) rotate(3deg)'}, {transform:'translateX(-2%)'}, {transform:'none'}], {duration:300}); }

  /* 한 번 재생 = Run: 타이머 묶음. 멈추면 전부 취소 */

  /* ═══ 소리 — 음원 파일 없이 Web Audio 로 직접 연주 (대표님 2026-10-25)
     재생 시작 때 장면 시각표대로 전부 미리 예약 → 화면과 박자가 어긋나지 않음. 멈추면 그 회차 출력만 끊음 ═══ */
  var AC = null, NOISE = null, muted = false;
  try { muted = localStorage.getItem('mc_motion_mute') === '1'; } catch (e) {}
  function audio(){
    if (!AC){
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      AC = new C();
      NOISE = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
      var d = NOISE.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }
  function Sound(){
    var ac = this.ac = audio(); if (!ac) return;
    this.out = ac.createGain(); this.out.gain.value = muted ? 0 : .8;
    var comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.out.connect(comp); comp.connect(ac.destination);
    this.t0 = ac.currentTime + .05;
  }
  var S = Sound.prototype;
  S.t = function(ms){ return this.t0 + ms / 1000; };
  S.stop = function(){ if (!this.out) return; var g = this.out; g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, this.ac.currentTime); setTimeout(function(){ g.disconnect(); }, 80); };
  /* 소리 한 개: 음량 봉투(빠르게 올라가 지수로 줄어듦) */
  S.env = function(t, vol, a, d){ var g = this.ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); g.connect(this.out); return g; };
  S.osc = function(type, t, f, f2, vol, a, d, lp){
    if (!this.ac) return;
    var o = this.ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d * .6);
    var g = this.env(t, vol, a, d), n = o;
    if (lp){ var fl = this.ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); n = fl; }
    n.connect(g); o.start(t); o.stop(t + a + d + .05);
  };
  S.noise = function(t, vol, a, d, type, f, f2, q){
    if (!this.ac) return;
    var src = this.ac.createBufferSource(); src.buffer = NOISE;
    var fl = this.ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    src.connect(fl); fl.connect(this.env(t, vol, a, d)); src.start(t); src.stop(t + a + d + .05);
  };
  /* 악기 — 로파이·트랩 힙합 (효과음 없이 음악만) */
  var SAT = null;
  function sat(ac){ if (SAT) return SAT; SAT = new Float32Array(1024); for (var i = 0; i < 1024; i++){ var x = i / 512 - 1; SAT[i] = Math.tanh(x * 2.2); } return SAT; }
  S.kick  = function(t, v){ this.osc('sine', t, 150, 45, v || .85, .002, .26); this.noise(t, .12, .001, .012, 'highpass', 2500); };
  S.snare = function(t, v){ v = v || .3; this.noise(t, v, .001, .16, 'bandpass', 2000, 0, .7); this.noise(t, v * .5, .001, .09, 'highpass', 5000); this.osc('triangle', t, 200, 150, v * .5, .001, .07); };
  S.hat   = function(t, v, open){ this.noise(t, v || .07, .001, open ? .22 : .03, 'highpass', 8000); };
  /* 808 베이스: 음이 살짝 미끄러져 내려오며 길게, 작은 스피커에서도 들리게 살짝 찌그러뜨림 */
  S.b808  = function(t, f, dur, v){
    if (!this.ac) return;
    var o = this.ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + .05);
    var ws = this.ac.createWaveShaper(); ws.curve = sat(this.ac);
    var g = this.ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v || .42, t + .006);
    g.gain.setValueAtTime(v || .42, t + dur * .55); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(ws); ws.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + .05);
  };
  /* 일렉 피아노 느낌 건반 — 음마다 살짝 어긋난 음정(로파이) */
  S.keys  = function(t, fs, dur, v){ var self = this; v = v || .05; fs.forEach(function(f){
    var d = (Math.random() - .5) * 14;
    self.osc('sine', t, f * Math.pow(2, d / 1200), 0, v, .012, dur, 2400);
    self.osc('triangle', t, f * 2, 0, v * .18, .006, dur * .5, 2000); }); };
  S.pluck = function(t, f, v){ this.osc('triangle', t, f, 0, v || .09, .003, .32, 3200); this.osc('sine', t, f * 2, 0, (v || .09) * .35, .003, .2); };
  S.rise  = function(t, dur, v){ var src = this.ac && this.ac.createBufferSource(); if (!src) return;
    src.buffer = NOISE; src.loop = true;
    var fl = this.ac.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 1.4; fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(7000, t + dur);
    var g = this.ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur * .95); g.gain.linearRampToValueAtTime(.0001, t + dur + .02);
    src.connect(fl); fl.connect(g); g.connect(this.out); src.start(t); src.stop(t + dur + .05); };
  S.crash = function(t, v){ this.noise(t, v || .12, .002, 1.4, 'highpass', 5000); };
  S.pad   = function(t, fs, dur, v){ var self = this; if (!this.ac) return; v = v || .03; fs.forEach(function(f){ [-8, 8].forEach(function(c){
    var o = self.ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c;
    var fl = self.ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1100;
    var g = self.ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + .25); g.gain.setValueAtTime(v, t + dur * .5); g.gain.linearRampToValueAtTime(.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(self.out); o.start(t); o.stop(t + dur + .05); }); }); };
  /* LP 판 지글거림 — 곡 내내 아주 작게 */
  S.vinyl = function(t, dur){
    if (!this.ac) return;
    var sr = this.ac.sampleRate, buf = this.ac.createBuffer(1, sr * 2, sr), d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() < .0009 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * .015;
    var src = this.ac.createBufferSource(); src.buffer = buf; src.loop = true;
    var fl = this.ac.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = 1200;
    var g = this.ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.35, t + .3); g.gain.setValueAtTime(.35, t + dur - 1.5); g.gain.linearRampToValueAtTime(.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(this.out); src.start(t); src.stop(t + dur + .05); };

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
  Run.prototype.stop = function(){ this.tm.forEach(clearTimeout); if (this.snd) this.snd.stop(); };

  /* 장면을 base 시각에 맞춰 예약하는 도우미 */
  function scene(R, base, fn){ R.at(base, function(){ fn(function(ms, f){ R.at(base + ms, f); }); }); }

  /* ═══ 박자 — 128 BPM, 한 박 468.75ms. 화면·음악 모두 이 격자(박 번호)로 맞춘다 ═══ */
  var BPM = 128, BEAT = 60000 / BPM;
  function b(n){ return n * BEAT; }

  /* ── 공통: 시작 「MAKECHANGO / 메뉴 이름」 — 글자는 16분음표마다 하나씩 (음악 아르페지오와 같은 자리) ── */
  function intro(R, title, color){
    scene(R, 0, function(T){
      var L = R.layer(NAVY);
      var w = h('div', 'mm-logo', null, L);
      'MAKECHANGO'.split('').forEach(function(c, i){
        var s = h('span', 'mm-ch ' + (i < 4 ? 'lt' : 'bd'), c, w);
        /* 박에 「착지」하도록: 떨어지기 시작 = 착지 박 - 200ms */
        s.animate([{transform:'translateY(-140%) rotate(-14deg)', opacity:0}, {transform:'none', opacity:1}],
          {duration:200, delay:Math.max(0, b((i + 2) / 4) - 200), easing:'cubic-bezier(.5,0,.75,1.3)', fill:'both'});
      });
      var ln = h('div', 'mm-line', null, L); ln.style.color = color;
      ln.animate([{width:'0'}, {width:'46cqw'}], {duration:b(.5), delay:b(3), easing:'cubic-bezier(.6,0,.2,1)', fill:'forwards'});
      var k = h('div', 'mm-hv mm-mid', title, L); k.style.color = color; pop(k, b(4) - 60);
    });
  }

  /* ── 공통: 끝 「MAKECHANGO (얇은 영문) / 실 같은 줄 / DEV. 메이크마인디자인」 ── */
  function outro(R, beat){
    scene(R, b(beat), function(T){
      var L = R.layer(NAVY);
      var w = h('div', 'mm-fine', null, L);
      'MAKECHANGO'.split('').forEach(function(c, i){
        var s = h('span', 'mm-ch', c, w);
        s.animate([{opacity:0, transform:'translateY(30%)', filter:'blur(.6cqw)'}, {opacity:1, transform:'none', filter:'blur(0)'}],
          {duration:b(1), delay:b(i / 4), easing:'cubic-bezier(.2,.7,.2,1)', fill:'both'});
      });
      var ln = h('div', 'mm-hair', null, L);
      var d = h('div', 'mm-mono', 'DEV. <b style="font-family:\'Noto Sans KR\',sans-serif;font-weight:300;letter-spacing:.08em">메이크마인디자인</b>', L);
      d.style.cssText = 'font-size:2.3cqw;color:' + BLUE; slideUp(d, b(3));
      var m = h('div', 'mm-mono', 'MAKEMINE DESIGN · MAKECHANGO', L);
      m.style.cssText = 'font-size:1.3cqw;opacity:.45;margin-top:1.2cqw'; slideUp(m, b(3.5));
      /* 줄 길이 = 위 영문보다 짧고, 아래 두 줄보다 길게 */
      var tw = w.getBoundingClientRect().width, dw = Math.max(d.getBoundingClientRect().width, m.getBoundingClientRect().width);
      var lw = dw + (tw - dw) * .45;
      ln.animate([{width:'0'}, {width:lw + 'px'}], {duration:b(1.5), delay:b(2), easing:'cubic-bezier(.6,0,.2,1)', fill:'forwards'});
    });
  }

  /* 단어 바꿈: [[글자, 바탕, 글자색, 크기, 흔들기], …] 박 번호 beats[i] 에 정확히 */
  function words(R, beats, list){
    list.forEach(function(x, i){
      R.at(b(beats[i]), function(){
        var L = R.layer(x[1]);
        var e = h('div', 'mm-hv ' + (x[3] || 'mm-big'), x[0], L); e.style.color = x[2];
        pop(e); if (x[4]) R.at(b(beats[i] + .5), function(){ shake(e); });
      });
    });
  }

  /* 입체 창고에 떨어지는 파렛트 자리 '열,행' */
  var FILL = ['0,0','1,0','2,0','4,0','5,0','0,1','1,1','3,1','4,1','0,2','2,2','3,2','5,2','1,3','2,3','3,3','4,3'];

  /* ═══ 창고관리 (wms) — 56박 ≈ 26초. [박] 표시 = 그 순간 음악에서 나는 것 ═══ */
  function wms(R){
    intro(R, '창고관리', BLUE);                                  /* [0~3] 건반 + 16분 아르페지오 = 글자 / [4] 비트 시작 = 「창고관리」 */

    words(R, [8, 9, 10, 11], [['창고가', NAVY, '#fff'], ['한눈에', BLUE, NAVY], ['보인다?', NAVY, '#fff'], ['보인다!!', ORANGE, NAVY, 0, true]]);

    /* [12~23] 입체 창고 */
    scene(R, b(12), function(T){
      var L = R.layer('radial-gradient(ellipse at 50% 40%,#123066 0%,' + NAVY + ' 70%)');
      var px = R.W, COLS = 6, ROWS = 4, C = 7.2 * px, H = 4.2 * px;
      var iso = h('div', 'mm-iso', null, L);
      var fl = h('div', 'mm-floor', null, iso);
      fl.style.cssText = 'width:' + COLS * C + 'px;height:' + ROWS * C + 'px;left:' + (-COLS * C / 2) + 'px;top:' + (-ROWS * C / 2) + 'px;background-size:' + C + 'px ' + C + 'px';
      'ABCD'.split('').forEach(function(r, i){ var lb = h('div', 'mm-lb', r, fl); lb.style.cssText = 'left:' + (-2.2 * px) + 'px;top:' + (i * C + C * .35) + 'px'; });
      for (var c = 0; c < COLS; c++){ var lb = h('div', 'mm-lb', String(c + 1), fl); lb.style.cssText = 'top:' + (-2.4 * px) + 'px;left:' + (c * C + C * .42) + 'px'; }
      /* 주의: 입체 묶음(.mm-iso·.mm-pal)에 opacity 애니메이션을 걸면 크롬이 납작하게 눌러 버림 → 크기·visibility 로만 */
      iso.animate([{transform:'rotateX(58deg) rotateZ(-225deg) scale(.05)'}, {transform:'rotateX(58deg) rotateZ(-45deg) scale(1)'}],
        {duration:b(1.5), easing:'cubic-bezier(.2,.8,.2,1)', fill:'both'});
      var pals = {};
      FILL.forEach(function(k){
        var cc = +k.split(',')[0], rr = +k.split(',')[1];
        var p = h('div', 'mm-pal', '<i class="t"></i><i class="s"></i><i class="w"></i>', fl);
        p.style.cssText = 'left:' + (cc * C + C * .12) + 'px;top:' + (rr * C + C * .12) + 'px;width:' + C * .76 + 'px;height:' + C * .76 + 'px';
        p.querySelector('.t').style.transform = 'translateZ(' + H + 'px)';
        p.querySelector('.s').style.height = H + 'px';
        p.querySelector('.w').style.width = H + 'px';
        p.style.visibility = 'hidden';
        /* 16분음표 하이햇마다 한 줄씩 착지: [13 + (열+행)/4] */
        p.animate([{transform:'translateZ(' + 30 * px + 'px)', visibility:'visible'}, {transform:'translateZ(0)', visibility:'visible', offset:.85}, {transform:'translateZ(' + px + 'px)', visibility:'visible', offset:.93}, {transform:'translateZ(0)', visibility:'visible'}],
          {duration:240, delay:b(1 + (cc + rr) / 4) - 204, easing:'cubic-bezier(.55,0,.8,.6)', fill:'forwards'});
        pals[k] = p;
      });
      var cap = h('div', 'mm-cap mm-hv', '', L);
      function say(t){ cap.innerHTML = t; pop(cap); }
      T(b(1), function(){ say('창고 로케이션,'); });                   /* [13] */
      T(b(3), function(){ say('<em>칸칸이 전부</em> 관리'); });          /* [15] 스네어 */
      T(b(5), function(){                                               /* [17] 들어 올림 → [19] 착지 */
        say('옮길 땐?<br><em>끌어다 놓으면 끝</em>');
        var p = pals['1,1']; p.classList.add('hot');
        var tg = h('div', 'mm-target', null, fl);
        tg.style.cssText = 'left:' + (5 * C + C * .08) + 'px;top:' + (3 * C + C * .08) + 'px;width:' + C * .84 + 'px;height:' + C * .84 + 'px';
        pop(tg);
        var a = { l:(1 * C + C * .12) + 'px', t:(1 * C + C * .12) + 'px' }, z = { l:(5 * C + C * .12) + 'px', t:(3 * C + C * .12) + 'px' };
        p.animate([
          {left:a.l, top:a.t, transform:'translateZ(0)'},
          {left:a.l, top:a.t, transform:'translateZ(' + 2.4 * H + 'px)', offset:.2},
          {left:z.l, top:z.t, transform:'translateZ(' + 2.4 * H + 'px)', offset:.8},
          {left:z.l, top:z.t, transform:'translateZ(0)'}], {duration:b(1.5), delay:b(.5), easing:'ease-in-out', fill:'forwards'});
        R.at(b(19.5), function(){ tg.remove(); p.classList.remove('hot'); });
      });
      T(b(8), function(){                                               /* [20] 유통기한 — 8분음표마다 하나씩 색 */
        say('유통기한 임박?<br><em>색깔이 먼저 일러줌</em> 🚨');
        [['0,0','red'],['3,2','red'],['4,3','yel'],['2,0','yel'],['0,2','yel']].forEach(function(x, i){
          var p = pals[x[0]];
          R.at(b(20.5 + i * .5), function(){
            p.classList.add(x[1]);
            p.animate([{transform:'translateZ(0)'}, {transform:'translateZ(' + 1.6 * px + 'px)'}, {transform:'translateZ(0)'}], {duration:b(.5), iterations:3});
          });
        });
      });
    });

    /* [24~31] 실시간 동기화 */
    scene(R, b(24), function(T){
      var L = R.layer('#0b1a33'), px = R.W;
      function grid(dev, cols, rows){ dev.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)'; var bs = []; for (var i = 0; i < cols * rows; i++) bs.push(h('b', null, null, dev)); return bs; }
      var ph = h('div', 'mm-dev', null, L); ph.style.cssText = 'left:12cqw;top:15cqw;width:15cqw;height:28cqw;border-radius:2.2cqw';
      var pb = grid(ph, 3, 6);
      var pc = h('div', 'mm-dev', null, L); pc.style.cssText = 'right:10cqw;top:14cqw;width:42cqw;height:25cqw';
      var cb = grid(pc, 6, 4);
      var base = h('div', 'mm-base', null, L); base.style.cssText = 'right:7cqw;top:39.8cqw;width:48cqw';
      pop(ph); pop(pc, b(.5)); pop(base, b(.5));
      var cap = h('div', 'mm-top mm-hv', '', L);
      T(b(1), function(){ cap.innerHTML = '폰에서 찍으면,'; pop(cap);                     /* [25] */
        var r = h('div', 'mm-rip', null, L); r.style.cssText = 'left:17.5cqw;top:25cqw';
        r.animate([{transform:'scale(.2)', opacity:1}, {transform:'scale(1.8)', opacity:0}], {duration:b(1), iterations:2});
        pb[7].classList.add('on'); });
      T(b(2), function(){                                                                   /* [26] 16분음표 4개 = 신호 4개 */
        for (var i = 0; i < 4; i++){ var d = h('div', 'mm-dot', null, L); d.style.cssText = 'left:22cqw;top:26cqw';
          d.animate([{transform:'translate(0,0) scale(.6)', opacity:0}, {transform:'translate(' + 16 * px + 'px,' + (-10 * px) + 'px) scale(1)', opacity:1, offset:.5}, {transform:'translate(' + 36 * px + 'px,' + (-1 * px) + 'px) scale(.6)', opacity:0}],
            {duration:b(1), delay:b(i / 4), easing:'ease-in-out', fill:'both'}); }
      });
      T(b(3), function(){ cb[9].classList.add('on'); pop(cb[9]); cap.innerHTML = 'PC에 <span class="mm-em">바로</span> 뜬다'; pop(cap); });   /* [27] 스네어 */
      T(b(4), function(){                                                                   /* [28] [28.5] [29] */
        var tg = h('div', null, null, L); tg.style.cssText = 'position:absolute;left:0;right:0;bottom:4.5cqw;text-align:center';
        ['실시간 동기화', '설치 없음', '폰·태블릿·PC'].forEach(function(t, i){ var s = h('span', 'mm-tag', t, tg); s.style.color = i === 0 ? ORANGE : BLUE; s.style.opacity = 0; pop(s, b(i / 2)); });
      });
    });

    /* [32~39] 체크리스트 — 8분음표마다 체크 (음악의 멜로디 음과 같은 자리) */
    scene(R, b(32), function(T){
      var L = R.layer(WHITE);
      var t = h('div', 'mm-top mm-hv', '그리고 또,', L); t.style.cssText += ';color:' + NAVY + ';font-size:5.4cqw'; pop(t);
      var box = h('div', 'mm-list', null, L);
      var ITEMS = ['입고 자동 배치', '출고대기 예약 · 확정', '바로출고', '되돌리기 (Undo)', '작업 히스토리 기록', '엑셀 · 구글시트 내보내기',
        '공지 메모', '업체별 재고 보고서', '그룹 · 권한 관리', '파렛트 일괄 수정'];
      ITEMS.forEach(function(x, i){
        var it = h('div', 'mm-it', '<span class="mm-box"></span>' + x, box);
        slideUp(it, b(1 + i / 2) - 120);
        T(b(1 + i / 2), function(){ it.classList.add('ok'); });
      });
      T(b(6), function(){                                                                   /* [38] */
        var e = h('div', 'mm-hv', '…더 있음. <span class="mm-em">진짜로.</span>', L);
        e.style.cssText = 'position:absolute;right:5cqw;bottom:4.5cqw;font-size:4cqw;color:' + NAVY; pop(e);
      });
    });

    /* [40~43] 브레이크 — 비트 빠짐 / [42~43] 스네어 롤 / [44] 다시 터지며 문 열림 */
    words(R, [40, 42], [['이건 맛보기.', NAVY, '#fff', 'mm-mid'], ['로그인하면,', BLUE, NAVY, 'mm-mid']]);
    scene(R, b(44), function(T){
      var L = R.layer(NAVY);
      var lt = h('div', 'mm-light', null, L);
      var tx = h('div', 'mm-hv mm-mid', '창고가 열립니다', L); tx.style.cssText = 'position:relative;color:' + NAVY;
      var dl = h('div', 'mm-door l', null, L), dr = h('div', 'mm-door r', null, L);
      dl.animate([{transform:'none'}, {transform:'translateX(-100%)'}], {duration:b(1.5), easing:'cubic-bezier(.7,0,.2,1)', fill:'forwards'});
      dr.animate([{transform:'none'}, {transform:'translateX(100%)'}], {duration:b(1.5), easing:'cubic-bezier(.7,0,.2,1)', fill:'forwards'});
      lt.animate([{opacity:.3}, {opacity:1}], {duration:b(2), fill:'both'});
      tx.style.opacity = 0; pop(tx, b(1));                                                  /* [45] */
    });

    outro(R, 48);                                                                           /* [48~] 마지막 화음 */
  }

  /* ═══ 창고관리 음악 — 128 BPM 로파이·트랩 (반박자 느낌: 스네어는 마디의 3박째)
     Fmaj7 – Em7 – Dm7 – Cmaj7 내려가는 진행, 808 베이스, LP 지글거림. 효과음 없이 화면이 음악에 맞춘다 ═══ */
  function wmsSound(S){
    var T = function(beat){ return S.t(b(beat)); }, i, bar, k;
    var ROOT = [87.31, 82.41, 73.42, 65.41],
        CHORD = [[174.6, 220, 261.6, 329.6], [164.8, 196, 246.9, 293.7], [146.8, 174.6, 220, 261.6], [130.8, 164.8, 196, 246.9]],
        ARP = [[349.2, 440, 523.3, 659.3], [329.6, 392, 493.9, 587.3], [293.7, 349.2, 440, 523.3], [261.6, 329.6, 392, 493.9]];
    S.vinyl(T(0), b(56) / 1000);

    /* 마디 하나 연주: 0=인트로(건반만) 1=풀 비트 2=브레이크 */
    function barPlay(n, mode){
      var c = n % 4, o = n * 4;
      /* 건반: 1박 길게 · 2.5박 · 3.75박 짧게 (로파이 엇박 반주) */
      S.keys(T(o), CHORD[c], b(1.6) / 1000, mode === 2 ? .04 : .05);
      S.keys(T(o + 1.5), CHORD[c].slice(1), b(.8) / 1000, .035);
      if (mode !== 2) S.keys(T(o + 2.75), CHORD[c].slice(2), b(.5) / 1000, .03);
      if (mode === 0) { for (k = 0; k < 8; k++) S.hat(T(o + k / 2), .03); return; }
      if (mode === 2) return;
      /* 드럼: 킥 1 · 2.75 · 3.5 / 스네어 3 / 하이햇 8분, 짝수 마디 끝 16분 롤 */
      S.kick(T(o)); S.kick(T(o + 1.75), .6); S.kick(T(o + 2.5), .7);
      S.snare(T(o + 2));
      for (k = 0; k < 8; k++) S.hat(T(o + k / 2), k % 2 ? .05 : .08);
      if (n % 2) { S.hat(T(o + 3.25), .05); S.hat(T(o + 3.75), .05); }
      S.hat(T(o + 1.5), .06, true);
      /* 808 */
      S.b808(T(o), ROOT[c] / 2, b(1.6) / 1000);
      S.b808(T(o + 2.5), ROOT[c] / 2, b(1.2) / 1000, .34);
    }

    /* [0~3] 인트로: 건반 + 글자마다 아르페지오 16분음 (10글자 = 2/4 ~ 11/4 박) */
    barPlay(0, 0);
    for (i = 0; i < 10; i++) S.pluck(T((i + 2) / 4), ARP[0][i % 4] * (i >= 8 ? 2 : 1), .07);
    S.rise(T(3), b(1) / 1000, .08);
    /* [4~39] 풀 비트 — [4] 「창고관리」에서 쾅 */
    S.crash(T(4), .12);
    for (bar = 1; bar < 10; bar++) barPlay(bar, 1);
    /* [8~11] 창고가/한눈에/보인다?/보인다!! — 박마다 건반 화음 강세 */
    for (i = 0; i < 4; i++) S.keys(T(8 + i), CHORD[(2 + i) % 4].map(function(f){ return f * 2; }), b(.4) / 1000, .04);
    S.crash(T(12), .1);                                                        /* [12] 입체 창고 시작 */
    /* [13~15] 파렛트 착지 = 16분 하이햇 추가 */
    for (i = 0; i <= 8; i++) S.hat(T(13 + i / 4), .06);
    /* [20.5~22.5] 유통기한 색 = 8분 플럭 */
    [784, 659.3, 784, 880, 1046.5].forEach(function(f, i){ S.pluck(T(20.5 + i * .5), f, .06); });
    S.crash(T(24), .1);                                                        /* [24] 동기화 */
    for (i = 0; i < 4; i++) S.pluck(T(26 + i / 4), ARP[2][i] * 2, .05);         /* [26] 신호 4개 = 16분 아르페지오 */
    S.crash(T(32), .12);                                                       /* [32] 체크리스트 */
    /* [33~37.5] 체크 10개 = 8분음 멜로디 (코드 따라 올라감) */
    var MEL = [523.3, 659.3, 784, 880, 784, 659.3, 784, 880, 1046.5, 1174.7];
    for (i = 0; i < 10; i++) S.pluck(T(33 + i / 2), MEL[i], .07);
    /* [40~43] 브레이크: 건반만 + [42~44] 스네어 롤 점점 세게 + 상승 */
    barPlay(10, 2);
    for (i = 0; i < 8; i++) S.snare(T(42 + i / 4), .08 + i * .025);
    for (i = 0; i < 8; i++) S.snare(T(43 + i / 8), .2 + i * .02);
    S.rise(T(42), b(2) / 1000, .12);
    /* [44~47] 다시 터짐 — 문 열림 */
    S.crash(T(44), .2); barPlay(11, 1);
    /* [48~] 마지막: 킥+808 한 번, 긴 화음으로 닫음 */
    S.kick(T(48)); S.b808(T(48), ROOT[0] / 2, 2.4, .38); S.crash(T(48), .1);
    S.pad(T(48), [174.6, 261.6, 329.6, 392, 440], b(8) / 1000, .025);
    S.keys(T(48), [349.2, 440, 523.3, 659.3, 784], b(6) / 1000, .04);
    [523.3, 659.3, 784, 880].forEach(function(f, i){ S.pluck(T(50 + i / 2), f, .035); });
  }

  var SCENES = {
    wms: { len: Math.round(b(56)), run: wms, sound: wmsSound }
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
      R.snd = new Sound();
      if (R.snd.ac && SCENES[key].sound) SCENES[key].sound(R.snd);
      SCENES[key].run(R);
      R.at(SCENES[key].len, function(){ if (onEnd) onEnd(); });
      return SCENES[key].len;
    },
    stop: function(){ if (cur) cur.stop(); cur = null; },
    /* 소리 켜기/끄기 — 재생 중에도 바로 적용, 다음에도 기억 */
    isMuted: function(){ return muted; },
    setMuted: function(m){
      muted = !!m;
      try { localStorage.setItem('mc_motion_mute', muted ? '1' : '0'); } catch (e) {}
      if (cur && cur.snd && cur.snd.out) cur.snd.out.gain.setTargetAtTime(muted ? 0 : .8, cur.snd.ac.currentTime, .02);
    }
  };
})();
