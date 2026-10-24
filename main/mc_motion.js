/* ═══ 모션그래픽 프리젠테이션 재생기 (대표님 2026-10-25) ═══
   메인 전광판 뒷면 패널을 누르면 뜨는 짧은 모션그래픽. 키네틱 타이포 + 경쾌한 128BPM 음악(코드로 직접 연주).
   모든 메뉴가 같은 뼈대 — 56박(약 26초):
     [0~7]   MAKECHANGO + 메뉴 이름            [8~11]  네 단어 한 박씩
     [12~23] 대표 기능 ①(입체·과장)           [24~31] 대표 기능 ②
     [32~39] 체크리스트 10개                   [40~43] 「이건 맛보기.」「로그인하면,」(비트 빠짐)
     [44~47] 문 열림                           [48~55] MAKECHANGO / DEV. 메이크마인디자인
   화면과 음악은 같은 박자 격자 b(박)를 쓴다. 장면 틀이 「여기서 음 하나」(R.hit)를 남기면 음악이 그 박에 음을 넣는다.
   메뉴 대본은 mc_motion_menus.js → MCMotion.add(key, cfg) */
(function(){
  var NAVY = '#07101f', BLUE = '#4cc9ff', ORANGE = '#ff9a3c', WHITE = '#f4f7fb', RED = '#ff4d5e', YEL = '#ffd23f', GREEN = '#3ddc97', PINK = '#ff5fa2', VIOLET = '#9b7bff';

  var CSS = `
.mm-stage{position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:10px;background:${NAVY};container-type:inline-size;
  font-family:'Noto Sans KR','Outfit',system-ui,sans-serif;color:#fff;user-select:none;transition:background .16s}
.mm-l{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none}
.mm-hv{font-family:'Black Han Sans','Noto Sans KR',sans-serif;font-weight:400;letter-spacing:-.02em;line-height:1}
.mm-big{font-size:12.5cqw}
.mm-mid{font-size:7.2cqw}
.mm-ch{display:inline-block}
/* 시작 로고 = 홈페이지 메인 로고와 같은 Outfit (MAKE 가늘게 · CHANGO 굵게) / 끝 = 얇은 영문 + 실 같은 줄 */
.mm-logo{font-family:"Outfit",system-ui,sans-serif;font-size:11cqw;line-height:1;letter-spacing:-.03em;white-space:nowrap}
.mm-logo .lt{font-weight:200;color:rgba(255,255,255,.62);letter-spacing:.04em}
.mm-logo .bd{font-weight:900}
.mm-fine{font-family:"Outfit",system-ui,sans-serif;font-weight:100;font-size:8.5cqw;letter-spacing:.22em;margin-right:-.22em;line-height:1}
.mm-hair{height:1px;width:0;background:rgba(255,255,255,.7);margin:2.6cqw 0 2.2cqw}
.mm-line{height:.35cqw;width:0;background:currentColor;margin:2.2cqw 0 2cqw;border-radius:1cqw}
.mm-cap{position:absolute;left:5cqw;bottom:5.5cqw;font-size:5cqw;line-height:1.12;text-shadow:0 .4cqw 2cqw rgba(0,0,0,.65);text-align:left;z-index:5}
.mm-cap.top{bottom:auto;top:5cqw;font-size:4.6cqw}
.mm-cap em,.mm-em{font-style:normal;color:${ORANGE}}
.mm-tag{display:inline-block;font-weight:800;font-size:1.9cqw;letter-spacing:.12em;padding:.6cqw 1.6cqw;border:.25cqw solid currentColor;border-radius:99px;margin:0 .6cqw}
.mm-tags{position:absolute;left:0;right:0;bottom:4.5cqw;text-align:center;z-index:5}
.mm-mono{font-family:'Share Tech Mono',monospace;letter-spacing:.3em}
.mm-abs{position:absolute}
/* 입체 — 원근 없는 아이소메트릭 (주의: 입체 묶음에 opacity 애니메이션 금지 — 크롬이 납작하게 눌러 버림) */
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
.mm-pal.blu .t{background:#8fd8ff} .mm-pal.blu .s{background:#4fb2e6} .mm-pal.blu .w{background:#2f86b8}
.mm-pal.wood .t{background:#a87a4f} .mm-pal.wood .s{background:#7d5634} .mm-pal.wood .w{background:#5e3f25}
.mm-target{position:absolute;border:.3cqw dashed ${ORANGE};border-radius:.4cqw}
/* 기기 */
.mm-dev{position:absolute;border:.45cqw solid #cfe6ff;border-radius:1.4cqw;background:#0d2347;display:grid;gap:.5cqw;padding:1.4cqw}
.mm-dev b{display:block;border-radius:.3cqw;background:#ffffff1c;transition:background .2s,box-shadow .2s}
.mm-dev b.on{background:${ORANGE};box-shadow:0 0 2cqw ${ORANGE}}
.mm-base{position:absolute;height:1.2cqw;background:#cfe6ff;border-radius:0 0 1.5cqw 1.5cqw}
.mm-dot{position:absolute;width:1.4cqw;height:1.4cqw;border-radius:50%;background:${ORANGE};box-shadow:0 0 1.6cqw ${ORANGE}}
.mm-rip{position:absolute;width:4cqw;height:4cqw;border-radius:50%;border:.4cqw solid ${ORANGE}}
/* 종이(송장·PDF) */
.mm-doc{position:absolute;width:9cqw;height:12.5cqw;background:#fff;border-radius:.5cqw;box-shadow:0 .8cqw 2cqw #0008;overflow:hidden}
.mm-doc::before{content:'';position:absolute;left:0;right:0;top:0;height:2.2cqw;background:var(--c,${BLUE})}
.mm-doc i{position:absolute;left:1cqw;right:1cqw;height:.5cqw;background:#d6dbe6;border-radius:.3cqw}
.mm-doc b{position:absolute;left:0;right:0;bottom:1cqw;text-align:center;font-family:'Share Tech Mono',monospace;font-size:1.9cqw;color:${NAVY}}
.mm-doc .bc{position:absolute;left:1.2cqw;right:1.2cqw;top:6.6cqw;height:2.2cqw;background:repeating-linear-gradient(90deg,${NAVY} 0 .25cqw,#fff .25cqw .45cqw,${NAVY} .45cqw .55cqw,#fff .55cqw .9cqw)}
/* 바코드·스캐너 */
.mm-card{position:absolute;background:#fff;border-radius:1.2cqw;box-shadow:0 1.5cqw 4cqw #000a;color:${NAVY}}
.mm-bars{position:absolute;background:repeating-linear-gradient(90deg,${NAVY} 0 .4cqw,#fff .4cqw .7cqw,${NAVY} .7cqw .9cqw,#fff .9cqw 1.5cqw,${NAVY} 1.5cqw 2.1cqw,#fff 2.1cqw 2.4cqw)}
.mm-laser{position:absolute;height:.45cqw;background:${RED};box-shadow:0 0 1.5cqw ${RED},0 0 4cqw ${RED}}
.mm-ok{position:absolute;width:9cqw;height:9cqw;border-radius:50%;background:${GREEN};color:#fff;display:grid;place-items:center;font-size:6cqw;font-weight:900;box-shadow:0 0 4cqw ${GREEN}}
.mm-cnt{position:absolute;font-family:'Outfit',sans-serif;font-weight:900;font-size:9cqw;line-height:1}
.mm-row{position:absolute;left:0;right:0;height:3.6cqw;border-radius:.6cqw;background:#ffffff14;display:flex;align-items:center;gap:1cqw;padding:0 1.2cqw;font-size:1.9cqw;font-weight:700;white-space:nowrap;overflow:hidden}
.mm-row.ok{background:${GREEN}33;box-shadow:inset .5cqw 0 0 ${GREEN}}
.mm-row .k{font-family:'Share Tech Mono',monospace;color:${BLUE};min-width:7cqw}
/* 표 */
.mm-tbl{position:absolute;left:12cqw;right:12cqw;top:12cqw;height:30cqw}
.mm-tr{position:absolute;left:0;right:0;height:3.8cqw;display:grid;gap:.4cqw}
.mm-tr span{background:#ffffff12;border-radius:.4cqw;display:flex;align-items:center;padding:0 .8cqw;font-size:1.7cqw;font-weight:700;white-space:nowrap;overflow:hidden;transition:background .2s,color .2s}
.mm-tr.h span{background:${BLUE};color:${NAVY};font-weight:900}
.mm-tr span.ok{background:${GREEN};color:${NAVY}}
.mm-tr span.hl{background:${ORANGE};color:${NAVY}}
/* 파일 아이콘 */
.mm-file{position:absolute;width:8cqw;height:10cqw;border-radius:.6cqw .6cqw .6cqw .6cqw;background:#fff;box-shadow:0 1cqw 2.5cqw #0009;display:grid;place-items:end center;padding-bottom:1.2cqw}
.mm-file::before{content:'';position:absolute;right:0;top:0;width:2.6cqw;height:2.6cqw;background:linear-gradient(225deg,${NAVY} 50%,#cfd6e4 50%)}
.mm-file span{font-family:'Outfit',sans-serif;font-weight:900;font-size:1.8cqw;color:#fff;background:var(--c,${RED});padding:.2cqw .8cqw;border-radius:.4cqw}
.mm-file.big{width:15cqw;height:19cqw}
.mm-file.big span{font-size:3cqw}
/* 막대 그래프 · 숫자 */
.mm-chart{position:absolute;left:10cqw;right:10cqw;bottom:9cqw;height:24cqw;display:flex;align-items:flex-end;gap:1.6cqw;border-bottom:.3cqw solid #ffffff55}
.mm-chart b{flex:1;height:0;border-radius:.8cqw .8cqw 0 0;background:linear-gradient(${BLUE},#2d6cdf)}
.mm-chart b.hi{background:linear-gradient(${ORANGE},#e0571f)}
/* 말풍선 */
.mm-phone{position:absolute;left:50%;top:6cqw;width:30cqw;height:44cqw;margin-left:-15cqw;border:.5cqw solid #cfe6ff;border-radius:3cqw;background:#0d2347;overflow:hidden}
.mm-bub{position:absolute;max-width:20cqw;padding:1cqw 1.6cqw;border-radius:1.6cqw;font-size:1.9cqw;font-weight:700;line-height:1.3}
.mm-bub.l{left:2cqw;background:#ffffff;color:${NAVY};border-bottom-left-radius:.3cqw}
.mm-bub.r{right:2cqw;background:${YEL};color:${NAVY};border-bottom-right-radius:.3cqw}
.mm-bub.ph{width:14cqw;height:9cqw;background:linear-gradient(135deg,#f1c98a,#b8783a);padding:0}
/* 지도 핀 */
.mm-map{position:absolute;inset:6cqw 8cqw 9cqw;border-radius:1.4cqw;background:#0d2347;
  background-image:linear-gradient(#ffffff10 .15cqw,transparent .15cqw),linear-gradient(90deg,#ffffff10 .15cqw,transparent .15cqw);background-size:4cqw 4cqw}
.mm-pin{position:absolute;width:3.4cqw;height:3.4cqw;margin:-3.4cqw 0 0 -1.7cqw;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${ORANGE};box-shadow:0 0 2cqw ${ORANGE}}
.mm-pin::after{content:'';position:absolute;inset:1cqw;border-radius:50%;background:#fff}
/* 자물쇠 */
.mm-lock{position:absolute;left:50%;top:44%;width:18cqw;height:15cqw;margin:-4cqw 0 0 -9cqw;border-radius:2cqw;background:linear-gradient(${YEL},#e0a91c);box-shadow:0 1.5cqw 4cqw #000a}
.mm-shk{position:absolute;left:50%;top:44%;width:12cqw;height:14cqw;margin:-15cqw 0 0 -6cqw;border:2.2cqw solid #cfd6e4;border-bottom:none;border-radius:7cqw 7cqw 0 0}
.mm-pw{position:absolute;left:0;right:0;top:66%;text-align:center;font-size:5cqw;letter-spacing:1.5cqw;color:#fff}
/* 캔들 */
.mm-cd{position:absolute;bottom:0;width:3cqw;margin-left:-1.5cqw;border-radius:.3cqw}
.mm-cd::before{content:'';position:absolute;left:50%;width:.3cqw;margin-left:-.15cqw;top:-2cqw;bottom:-2cqw;background:inherit}
/* 사주 기둥 */
.mm-pil{position:absolute;top:9cqw;width:13cqw;height:30cqw;border-radius:1.2cqw;background:linear-gradient(#2a1d4a,#140d26);border:.3cqw solid ${VIOLET};
  display:flex;flex-direction:column;align-items:center;justify-content:space-around;font-family:'Noto Sans KR',serif;font-weight:900;color:#fff}
.mm-pil small{font-size:1.6cqw;color:${VIOLET};font-weight:700;letter-spacing:.2em}
.mm-pil b{font-size:7cqw;line-height:1;text-shadow:0 0 2cqw ${VIOLET}}
/* 사진기 */
.mm-vf{position:absolute;left:50%;top:46%;width:40cqw;height:28cqw;margin:-14cqw 0 0 -20cqw}
.mm-vf i{position:absolute;width:5cqw;height:5cqw;border:.5cqw solid #fff}
.mm-flash{position:absolute;inset:0;background:#fff;opacity:0}
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
    lk.href = 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@100;300;700;900&family=Outfit:wght@100;200;900&family=Share+Tech+Mono&display=swap';
    document.head.appendChild(lk);
  }

  function h(tag, cls, html, parent){
    var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e); return e;
  }
  function css(e, s){ e.style.cssText += ';' + s; return e; }
  /* 툭 튀어나오기 / 확 사라지기 */
  function pop(e, d){ return e.animate([{transform:'scale(.35)', opacity:0, filter:'blur(1cqw)'}, {transform:'scale(1.1)', opacity:1, filter:'blur(0)', offset:.7}, {transform:'scale(1)', opacity:1}],
    {duration:260, delay:d || 0, easing:'cubic-bezier(.2,.9,.3,1.3)', fill:'both'}); }
  function slideUp(e, d){ return e.animate([{transform:'translateY(60%)', opacity:0}, {transform:'none', opacity:1}], {duration:300, delay:d || 0, easing:'cubic-bezier(.2,.9,.3,1.2)', fill:'both'}); }
  function fly(e, from, d, dur){ return e.animate([{transform:from, opacity:0}, {transform:'none', opacity:1}], {duration:dur || 300, delay:d || 0, easing:'cubic-bezier(.2,.9,.3,1.15)', fill:'both'}); }
  function blast(e){ var a = e.animate([{opacity:1, transform:'none'}, {opacity:0, transform:'scale(1.5)', filter:'blur(1.2cqw)'}], {duration:240, easing:'ease-in', fill:'forwards'});
    a.onfinish = function(){ e.remove(); }; }
  function shake(e){ e.animate([{transform:'translateX(0)'}, {transform:'translateX(-3%) rotate(-3deg)'}, {transform:'translateX(3%) rotate(3deg)'}, {transform:'translateX(-2%)'}, {transform:'none'}], {duration:300}); }

  /* ═══ 소리 — 음원 파일 없이 Web Audio 로 직접 연주
     재생 시작 때 시각표대로 전부 미리 예약 → 화면과 박자가 어긋나지 않음. 멈추면 그 회차 출력만 끊음 ═══ */
  var AC = null, NOISE = null, muted = false;
  try { muted = localStorage.getItem('mc_motion_mute') === '1'; } catch (e) {}
  var VOL = .85;
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
  /* 신호 흐름: 악기 → out(킥마다 출렁이는 「펌핑」) ┐
                드럼 → dr ───────────────────────────┴→ master(소리 켜기/끄기) → 압축 → 스피커 */
  function Sound(){
    var ac = this.ac = audio(); if (!ac) return;
    this.master = ac.createGain(); this.master.gain.value = muted ? 0 : VOL;
    var comp = ac.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ac.destination);
    this.out = ac.createGain(); this.out.connect(this.master);
    this.dr = ac.createGain(); this.dr.connect(this.master);
    this.t0 = ac.currentTime + .05;
  }
  var S = Sound.prototype;
  S.t = function(ms){ return this.t0 + ms / 1000; };
  S.stop = function(){ if (!this.master) return; var g = this.master; g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, this.ac.currentTime); setTimeout(function(){ g.disconnect(); }, 80); };
  S.env = function(t, vol, a, d, dest){ var g = this.ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); g.connect(dest || this.out); return g; };
  S.osc = function(type, t, f, f2, vol, a, d, lp, dest){
    if (!this.ac) return;
    var o = this.ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d * .6);
    var g = this.env(t, vol, a, d, dest), n = o;
    if (lp){ var fl = this.ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); n = fl; }
    n.connect(g); o.start(t); o.stop(t + a + d + .05);
  };
  S.noise = function(t, vol, a, d, type, f, f2, q, dest){
    if (!this.ac) return;
    var src = this.ac.createBufferSource(); src.buffer = NOISE;
    var fl = this.ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    src.connect(fl); fl.connect(this.env(t, vol, a, d, dest)); src.start(t); src.stop(t + a + d + .05);
  };
  /* 악기 — 경쾌한 펑키 하우스 (참고: 블랙프라이데이 타이포 모션 광고) */
  S.kick  = function(t, v){ this.osc('sine', t, 165, 48, v || .9, .002, .24, 0, this.dr); this.noise(t, .14, .001, .012, 'highpass', 2500, 0, 1, this.dr); };
  S.clap  = function(t, v){ var self = this; [0, .011, .023].forEach(function(x){ self.noise(t + x, (v || .3) * (x ? .7 : 1), .001, x === .023 ? .14 : .02, 'bandpass', 1700, 0, 1.1, self.dr); }); };
  S.snare = function(t, v){ v = v || .3; this.noise(t, v, .001, .14, 'bandpass', 2100, 0, .8, this.dr); this.osc('triangle', t, 210, 160, v * .5, .001, .06, 0, this.dr); };
  S.hat   = function(t, v, open){ this.noise(t, v || .06, .001, open ? .16 : .028, 'highpass', open ? 7500 : 9000, 0, 1, this.dr); };
  S.pump  = function(t){ var g = this.out.gain; g.setValueAtTime(.38, t); g.linearRampToValueAtTime(1, t + .2); };
  S.bass  = function(t, f, d, v){ this.osc('sawtooth', t, f, 0, v || .3, .004, d || .14, 650); this.osc('sine', t, f / 2, 0, (v || .3) * .7, .004, d || .14); };
  S.stab  = function(t, fs, v){ var self = this; v = v || .05; fs.forEach(function(f){ self.osc('sawtooth', t, f, 0, v, .003, .13, 3400); self.osc('square', t, f * 2.004, 0, v * .35, .003, .08, 4200); }); };
  S.lead  = function(t, f, d, v){ this.osc('square', t, f, 0, v || .045, .004, d || .12, 2600); this.osc('sawtooth', t, f * 1.005, 0, (v || .045) * .6, .004, d || .12, 3000); };
  S.pluck = function(t, f, v){ this.osc('triangle', t, f, 0, v || .1, .002, .28, 5000); this.osc('square', t, f * 2, 0, (v || .1) * .22, .002, .1, 4000); };
  S.crash = function(t, v){ this.noise(t, v || .12, .002, 1.3, 'highpass', 5200, 0, 1, this.dr); };
  S.rise  = function(t, dur, v){ var src = this.ac && this.ac.createBufferSource(); if (!src) return;
    src.buffer = NOISE; src.loop = true;
    var fl = this.ac.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 1.4; fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(8000, t + dur);
    var g = this.ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur * .95); g.gain.linearRampToValueAtTime(.0001, t + dur + .02);
    src.connect(fl); fl.connect(g); g.connect(this.dr); src.start(t); src.stop(t + dur + .05); };
  S.pad   = function(t, fs, dur, v){ var self = this; if (!this.ac) return; v = v || .03; fs.forEach(function(f){ [-9, 9].forEach(function(c){
    var o = self.ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c;
    var fl = self.ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1800;
    var g = self.ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + .2); g.gain.setValueAtTime(v, t + dur * .55); g.gain.linearRampToValueAtTime(.0001, t + dur);
    o.connect(fl); fl.connect(g); g.connect(self.out); o.start(t); o.stop(t + dur + .05); }); }); };

  /* ═══ 박자 — 128 BPM, 한 박 468.75ms ═══ */
  var BPM = 128, BEAT = 60000 / BPM, LEN = 56;
  function b(n){ return n * BEAT; }

  /* ═══ 공통 곡 — 펑키 하우스: 킥 매 박 · 박수 2·4 · 엇박 오픈햇 · 통통 튀는 엇박 베이스 · 엇박 코드 스탭 · 훅 멜로디
     C–G–Am–F 진행(메뉴마다 key 로 조옮김). 장면이 남긴 hit(박, 종류)에 아르페지오·멜로디 음을 얹는다 ═══ */
  function song(S, hits, key){
    var K = Math.pow(2, (key || 0) / 12), T = function(x){ return S.t(b(x)); }, i;
    var CH = [[261.6, 329.6, 392, 523.3], [246.9, 293.7, 392, 493.9], [220, 261.6, 329.6, 440], [220, 261.6, 349.2, 440]]
      .map(function(c){ return c.map(function(f){ return f * K; }); });
    var RT = [65.41, 49, 55, 43.65].map(function(f){ return f * K; });
    var SC = [523.3, 587.3, 659.3, 784, 880, 1046.5, 1174.7, 1318.5, 1568, 1760, 2093].map(function(f){ return f * K; });
    var HOOK = [[0, 4, 2], [.75, 3, 1], [1.5, 4, 2], [2, 5, 1], [2.75, 4, 1], [3.5, 2, 1]];   /* [박, 음계칸, 길이(8분)] */

    function bar(n, mode){   /* 0 인트로 · 1 비트 · 2 브레이크 · 3 비트+훅 */
      var c = n % 4, o = n * 4, k;
      if (mode === 0 || mode === 2){ S.pad(T(o), CH[c], b(3.9) / 1000, mode === 2 ? .028 : .022); }
      else [0, .75, 1.5, 2.5, 3.25].forEach(function(x){ S.stab(T(o + x), CH[c], .042); });
      if (mode === 0){ for (k = 0; k < 8; k++) S.hat(T(o + k / 2), .025); return; }
      if (mode === 2) return;
      for (k = 0; k < 4; k++){ S.kick(T(o + k)); S.pump(T(o + k)); S.hat(T(o + k + .5), .07, true); }
      S.clap(T(o + 1)); S.clap(T(o + 3));
      for (k = 1; k < 16; k += 2) S.hat(T(o + k / 4), .03);
      [.5, 1.5, 2.5, 3.5].forEach(function(x){ S.bass(T(o + x), RT[c] * 2, .15); });
      S.bass(T(o + 1.75), RT[c] * 4, .08, .2); S.bass(T(o + 3.75), RT[c] * 4, .08, .2);
      if (mode === 3) HOOK.forEach(function(x){ S.lead(T(o + x[0]), SC[x[1]] * (c === 2 ? .89 : 1), b(x[2] / 2) / 1000 * .8); });
    }

    bar(0, 0); S.rise(T(3), b(1) / 1000, .07);
    S.crash(T(4), .14); bar(1, 1); bar(2, 3);
    for (i = 3; i < 10; i++) bar(i, i === 6 ? 3 : 1);
    S.crash(T(12), .1); S.crash(T(24), .1); S.crash(T(32), .12);
    bar(10, 2);
    for (i = 0; i < 8; i++) S.snare(T(42 + i / 4), .07 + i * .022);
    for (i = 0; i < 8; i++) S.snare(T(43 + i / 8), .2 + i * .018);
    S.rise(T(42), b(2) / 1000, .11);
    S.crash(T(44), .2); bar(11, 3);
    /* 마무리: 쾅 + 긴 화음 + 반짝이는 아르페지오 */
    S.kick(T(48)); S.crash(T(48), .12); S.bass(T(48), RT[0] * 2, 1.2, .25);
    S.pad(T(48), CH[0].concat([CH[0][1] * 2]), b(7.5) / 1000, .026);
    [0, 2, 4, 5, 7, 9].forEach(function(n, i){ S.pluck(T(49 + i / 2), SC[n], .05); });

    /* 장면이 남긴 음: arp = 그 마디 화음을 차례로, mel = 음계를 한 칸씩 위로, hit = 화음 쾅 */
    var ai = 0;
    hits.forEach(function(x){
      var c = Math.floor(x.b / 4) % 4;
      if (x.k === 'arp') S.pluck(T(x.b), CH[c][ai++ % 4] * 2, .075);
      else if (x.k === 'mel') S.pluck(T(x.b), SC[Math.min(x.i || 0, SC.length - 1)], .085);
      else if (x.k === 'hit') { S.stab(T(x.b), CH[c].map(function(f){ return f * 2; }), .05); S.crash(T(x.b), .07); }
    });
  }

  /* ═══ 한 번 재생 = Run: 타이머 묶음. 멈추면 전부 취소 ═══ */
  var cur = null;
  function Run(stage){ this.st = stage; this.tm = []; this.hits = []; this.W = stage.clientWidth / 100; this.t0 = performance.now() + 50; }
  /* ms = 재생 시작부터의 시각 (장면 안에서 예약해도 기준은 시작) */
  Run.prototype.at = function(ms, fn){ var self = this; this.tm.push(setTimeout(function(){ if (cur === self) fn(); }, Math.max(0, ms - (performance.now() - this.t0)))); };
  Run.prototype.hit = function(beat, k, i){ this.hits.push({ b:beat, k:k, i:i }); };
  Run.prototype.layer = function(bg){
    [].slice.call(this.st.querySelectorAll('.mm-l')).forEach(function(o){ blast(o); });
    if (bg) this.st.style.background = bg;
    return h('div', 'mm-l', null, this.st);
  };
  Run.prototype.stop = function(){ this.tm.forEach(clearTimeout); if (this.snd) this.snd.stop(); };

  /* 장면을 B0 박에 열고, 안에서는 T(상대 박, fn) 으로 예약 */
  function scene(R, B0, fn){ R.at(b(B0), function(){ fn(function(rb, f){ R.at(b(B0 + rb), f); }); }); }
  /* 자막: caps = [[상대 박, 'html'], …] */
  function captions(T, L, caps, top){
    if (!caps || !caps.length) return;
    var cap = h('div', 'mm-cap mm-hv' + (top ? ' top' : ''), '', L);
    caps.forEach(function(c){ T(c[0], function(){ cap.innerHTML = c[1]; pop(cap); }); });
  }

  /* ═══ 공통 장면 ═══ */
  function intro(R, title, color){
    for (var i = 0; i < 10; i++) R.hit((i + 2) / 4, 'arp');
    R.hit(4, 'hit');
    scene(R, 0, function(T){
      var L = R.layer(NAVY);
      var w = h('div', 'mm-logo', null, L);
      'MAKECHANGO'.split('').forEach(function(c, i){
        var s = h('span', 'mm-ch ' + (i < 4 ? 'lt' : 'bd'), c, w);
        s.animate([{transform:'translateY(-140%) rotate(-14deg)', opacity:0}, {transform:'none', opacity:1}],
          {duration:200, delay:Math.max(0, b((i + 2) / 4) - 200), easing:'cubic-bezier(.5,0,.75,1.3)', fill:'both'});
      });
      var ln = h('div', 'mm-line', null, L); ln.style.color = color;
      ln.animate([{width:'0'}, {width:'46cqw'}], {duration:b(.5), delay:b(3), easing:'cubic-bezier(.6,0,.2,1)', fill:'forwards'});
      var k = h('div', 'mm-hv mm-mid', title, L); k.style.color = color; k.style.whiteSpace = 'nowrap'; pop(k, b(4) - 60);
    });
  }
  function outro(R){
    scene(R, 48, function(T){
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
      ln.animate([{width:'0'}, {width:(dw + (tw - dw) * .45) + 'px'}], {duration:b(1.5), delay:b(2), easing:'cubic-bezier(.6,0,.2,1)', fill:'forwards'});
    });
  }
  /* 단어 바꿈: beats[i] 에 list[i] = [글자, 바탕, 글자색, 크기클래스, 흔들기] */
  function words(R, beats, list){
    list.forEach(function(x, i){
      R.at(b(beats[i]), function(){
        var L = R.layer(x[1]);
        var e = h('div', 'mm-hv ' + (x[3] || 'mm-big'), x[0], L); e.style.color = x[2]; e.style.whiteSpace = 'nowrap';
        pop(e); if (x[4]) R.at(b(beats[i] + .5), function(){ shake(e); });
      });
    });
  }
  function four(R, w){
    words(R, [8, 9, 10, 11], [[w[0], NAVY, '#fff'], [w[1], BLUE, NAVY], [w[2], NAVY, '#fff'], [w[3], ORANGE, NAVY, 0, true]]);
  }
  function checklist(R, items, title){
    for (var i = 0; i < items.length; i++) R.hit(33 + i / 2, 'mel', i);
    scene(R, 32, function(T){
      var L = R.layer(WHITE);
      var t = h('div', 'mm-cap top mm-hv', title || '그리고 또,', L); css(t, 'color:' + NAVY + ';font-size:5.4cqw;text-shadow:none'); pop(t);
      var box = h('div', 'mm-list', null, L);
      items.forEach(function(x, i){
        var it = h('div', 'mm-it', '<span class="mm-box"></span>' + x, box);
        slideUp(it, b(1 + i / 2) - 120);
        T(1 + i / 2, function(){ it.classList.add('ok'); });
      });
      T(6, function(){
        var e = h('div', 'mm-hv', '…더 있음. <span class="mm-em">진짜로.</span>', L);
        css(e, 'position:absolute;right:5cqw;bottom:4.5cqw;font-size:4cqw;color:' + NAVY); pop(e);
      });
    });
  }
  function door(R, w1, w2, open){
    words(R, [40, 42], [[w1 || '이건 맛보기.', NAVY, '#fff', 'mm-mid'], [w2 || '로그인하면,', BLUE, NAVY, 'mm-mid']]);
    R.hit(45, 'hit');
    scene(R, 44, function(T){
      var L = R.layer(NAVY);
      var lt = h('div', 'mm-light', null, L);
      var tx = h('div', 'mm-hv mm-mid', open || '창고가 열립니다', L); css(tx, 'position:relative;color:' + NAVY + ';white-space:nowrap');
      var dl = h('div', 'mm-door l', null, L), dr = h('div', 'mm-door r', null, L);
      dl.animate([{transform:'none'}, {transform:'translateX(-100%)'}], {duration:b(1.5), easing:'cubic-bezier(.7,0,.2,1)', fill:'forwards'});
      dr.animate([{transform:'none'}, {transform:'translateX(100%)'}], {duration:b(1.5), easing:'cubic-bezier(.7,0,.2,1)', fill:'forwards'});
      lt.animate([{opacity:.3}, {opacity:1}], {duration:b(2), fill:'both'});
      tx.style.opacity = 0; pop(tx, b(1));
    });
  }

  /* ═══ 대표 기능 장면 틀 — TPL[종류](R, 시작박, 길이(8|12), 옵션) ═══
     옵션 공통: caps = [[상대 박, '자막'], …], tags = ['태그', …](마지막 박 쪽에 동그란 표), bg */
  function tagsAt(T, L, tags, rb){
    if (!tags || !tags.length) return;
    T(rb, function(){
      var tg = h('div', 'mm-tags', null, L);
      tags.forEach(function(t, i){ var s = h('span', 'mm-tag', t, tg); s.style.color = i === 0 ? ORANGE : BLUE; s.style.opacity = 0; pop(s, b(i / 2)); });
    });
  }
  function grad(c){ return 'radial-gradient(ellipse at 50% 40%,' + (c || '#123066') + ' 0%,' + NAVY + ' 70%)'; }
  var TPL = {};

  /* 입체 창고: 파렛트가 칸칸이 떨어지고 → 하나 옮기고 → 유통기한 색 */
  var FILL = ['0,0','1,0','2,0','4,0','5,0','0,1','1,1','3,1','4,1','0,2','2,2','3,2','5,2','1,3','2,3','3,3','4,3'];
  function isoFloor(R, L, COLS, ROWS){
    var px = R.W, C = 7.2 * px;
    var iso = h('div', 'mm-iso', null, L), fl = h('div', 'mm-floor', null, iso);
    fl.style.cssText = 'width:' + COLS * C + 'px;height:' + ROWS * C + 'px;left:' + (-COLS * C / 2) + 'px;top:' + (-ROWS * C / 2) + 'px;background-size:' + C + 'px ' + C + 'px';
    iso.animate([{transform:'rotateX(58deg) rotateZ(-225deg) scale(.05)'}, {transform:'rotateX(58deg) rotateZ(-45deg) scale(1)'}], {duration:b(1.5), easing:'cubic-bezier(.2,.8,.2,1)', fill:'both'});
    return { fl:fl, C:C, px:px };
  }
  function box3(fl, x, y, w, d, hgt, cls){
    var p = h('div', 'mm-pal' + (cls ? ' ' + cls : ''), '<i class="t"></i><i class="s"></i><i class="w"></i>', fl);
    p.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + d + 'px';
    p.querySelector('.t').style.transform = 'translateZ(' + hgt + 'px)';
    p.querySelector('.s').style.height = hgt + 'px';
    p.querySelector('.w').style.width = hgt + 'px';
    return p;
  }
  function drop(p, zFrom, delay, z){ p.style.visibility = 'hidden';
    p.animate([{transform:'translateZ(' + zFrom + 'px)', visibility:'visible'}, {transform:'translateZ(' + (z || 0) + 'px)', visibility:'visible'}],
      {duration:220, delay:Math.max(0, delay - 200), easing:'cubic-bezier(.55,0,.8,.6)', fill:'forwards'}); }
  TPL.iso = function(R, B0, len, o){
    for (var d = 0; d <= 8; d++) R.hit(B0 + 1 + d / 4, 'arp');
    for (var i = 0; i < 5; i++) R.hit(B0 + 8.5 + i * .5, 'mel', 4 + i);
    scene(R, B0, function(T){
      var L = R.layer(grad()), f = isoFloor(R, L, 6, 4), C = f.C, H = 4.2 * f.px, fl = f.fl;
      'ABCD'.split('').forEach(function(r, i){ css(h('div', 'mm-lb', r, fl), 'left:' + (-2.2 * f.px) + 'px;top:' + (i * C + C * .35) + 'px'); });
      for (var c = 0; c < 6; c++) css(h('div', 'mm-lb', String(c + 1), fl), 'top:' + (-2.4 * f.px) + 'px;left:' + (c * C + C * .42) + 'px');
      var pals = {};
      FILL.forEach(function(k){
        var cc = +k.split(',')[0], rr = +k.split(',')[1];
        var p = box3(fl, cc * C + C * .12, rr * C + C * .12, C * .76, C * .76, H);
        drop(p, 30 * f.px, b(1 + (cc + rr) / 4)); pals[k] = p;
      });
      captions(T, L, o.caps || [[1, '창고 로케이션,'], [3, '<em>칸칸이 전부</em> 관리'], [5, '옮길 땐?<br><em>끌어다 놓으면 끝</em>'], [8, '유통기한 임박?<br><em>색깔이 먼저 일러줌</em> 🚨']]);
      T(5, function(){
        var p = pals['1,1']; p.classList.add('hot');
        var tg = css(h('div', 'mm-target', null, fl), 'left:' + (5 * C + C * .08) + 'px;top:' + (3 * C + C * .08) + 'px;width:' + C * .84 + 'px;height:' + C * .84 + 'px'); pop(tg);
        var a = { l:(C * 1.12) + 'px', t:(C * 1.12) + 'px' }, z = { l:(5 * C + C * .12) + 'px', t:(3 * C + C * .12) + 'px' };
        p.animate([{left:a.l, top:a.t, transform:'translateZ(0)'}, {left:a.l, top:a.t, transform:'translateZ(' + 2.4 * H + 'px)', offset:.2},
          {left:z.l, top:z.t, transform:'translateZ(' + 2.4 * H + 'px)', offset:.8}, {left:z.l, top:z.t, transform:'translateZ(0)'}], {duration:b(1.5), delay:b(.5), easing:'ease-in-out', fill:'forwards'});
        R.at(b(B0 + 7.5), function(){ tg.remove(); p.classList.remove('hot'); });
      });
      [['0,0','red'],['3,2','red'],['4,3','yel'],['2,0','yel'],['0,2','yel']].forEach(function(x, i){
        T(8.5 + i * .5, function(){ var p = pals[x[0]]; p.classList.add(x[1]);
          p.animate([{transform:'translateZ(0)'}, {transform:'translateZ(' + 1.6 * f.px + 'px)'}, {transform:'translateZ(0)'}], {duration:b(.5), iterations:3}); });
      });
    });
  };

  /* 파렛트 쌓기: 나무 파렛트 위로 상자가 8분음마다 층층이 → 숫자 */
  TPL.stack = function(R, B0, len, o){
    var N = 12; for (var i = 0; i < N; i++) R.hit(B0 + 1 + i / 2, 'arp');
    R.hit(B0 + 7.5, 'hit');
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg)), f = isoFloor(R, L, 4, 3), C = f.C, fl = f.fl, px = f.px;
      var base = box3(fl, C * .5, C * .25, C * 3, C * 2.5, px * 1.2, 'wood');
      var bx = C * .72, H = 3.6 * px, k = 0;
      for (var lv = 0; lv < 3; lv++) for (var yy = 0; yy < 2; yy++) for (var xx = 0; xx < 2; xx++){
        var p = box3(fl, C * .6 + xx * (bx + C * .66), C * .35 + yy * (bx + C * .4), bx * 1.6, bx * 1.4, H, lv === 2 && xx === 1 ? 'hot' : '');
        drop(p, 30 * px, b(1 + k / 2), px * 1.2 + lv * H); k++;
      }
      var n = css(h('div', 'mm-cnt', '0', L), 'right:6cqw;top:6cqw;color:' + ORANGE);
      for (i = 0; i < N; i++) (function(i){ T(1 + i / 2, function(){ n.textContent = (o.unit || '') + String(i + 1); pop(n); }); })(i);
      captions(T, L, o.caps);
      tagsAt(T, L, o.tags, len - 3);
    });
  };

  /* 종이 더미: 흩어진 송장·PDF 가 16분음마다 날아와 → 한 박에 착 정렬 → 순서대로 출력 */
  TPL.docs = function(R, B0, len, o){
    var labels = o.labels || ['A-01', 'A-03', 'B-02', 'A-02', 'C-01', 'B-01'];
    var n = labels.length, i;
    for (i = 0; i < n; i++) R.hit(B0 + 1 + i / 4, 'arp');
    R.hit(B0 + 4, 'hit');
    for (i = 0; i < n; i++) R.hit(B0 + 6 + i / 2, 'mel', i + 2);
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#16305e'));
      var order = labels.slice().sort(o.sort === false ? function(){ return 0; } : undefined);
      var docs = labels.map(function(lb, i){
        var d = h('div', 'mm-doc', '<i style="top:3.2cqw"></i><i style="top:4.4cqw;right:3cqw"></i><span class="bc"></span><i style="top:9.6cqw;right:4cqw"></i><b>' + lb + '</b>', L);
        d.style.setProperty('--c', [BLUE, ORANGE, GREEN, PINK, YEL, VIOLET][i % 6]);
        var x = 10 + (i * 37) % 70, y = 8 + (i * 23) % 26, r = (i % 2 ? 1 : -1) * (8 + i * 5);
        css(d, 'left:' + x + 'cqw;top:' + y + 'cqw;transform:rotate(' + r + 'deg)');
        fly(d, 'translate(' + (i % 2 ? 60 : -60) + 'cqw,-30cqw) rotate(' + (r * 3) + 'deg)', b(1 + i / 4) - 150, 260);
        return { d:d, r:r, lb:lb };
      });
      T(4, function(){   /* 착 정렬 */
        docs.forEach(function(x){
          var k = order.indexOf(x.lb), tx = 50 - (n * 11) / 2 + k * 11, ty = 14;
          x.d.animate([{left:x.d.style.left, top:x.d.style.top, transform:'rotate(' + x.r + 'deg)'}, {left:tx + 'cqw', top:ty + 'cqw', transform:'rotate(0)'}],
            {duration:b(.75), easing:'cubic-bezier(.7,0,.2,1.2)', fill:'forwards'});
        });
      });
      T(6, function(){
        docs.forEach(function(x){ var k = order.indexOf(x.lb);
          R.at(b(B0 + 6 + k / 2), function(){ x.d.animate([{transform:'none'}, {transform:'translateY(-2.5cqw) scale(1.08)'}, {transform:'none'}], {duration:b(.5)}); x.d.style.boxShadow = '0 0 0 .4cqw ' + ORANGE + ',0 .8cqw 2cqw #0008'; });
        });
      });
      captions(T, L, o.caps);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 스캔: 바코드 위로 빨간 레이저가 박마다 지나가고 「삑」 → 초록 ✓ + 숫자 · 오른쪽에 찍힌 목록 */
  TPL.scan = function(R, B0, len, o){
    var items = o.items || ['상품 A', '상품 B', '상품 C', '상품 D'], i;
    for (i = 0; i < items.length; i++) R.hit(B0 + 2 + i, 'mel', 2 + i * 2);
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#10294f'));
      var card = css(h('div', 'mm-card', null, L), 'left:8cqw;top:9cqw;width:36cqw;height:30cqw'); pop(card);
      css(h('div', 'mm-hv', o.label || 'SCAN', card), 'position:absolute;left:3cqw;top:2.4cqw;font-size:3cqw');
      css(h('div', 'mm-bars', null, card), 'left:3cqw;right:3cqw;top:9cqw;height:13cqw');
      css(h('div', 'mm-mono', o.code || '8 801234 567890', card), 'position:absolute;left:0;right:0;bottom:2cqw;text-align:center;font-size:1.8cqw');
      var lz = css(h('div', 'mm-laser', null, L), 'left:6cqw;width:40cqw;top:18cqw');
      lz.animate([{transform:'translateY(-6cqw)'}, {transform:'translateY(14cqw)'}], {duration:b(1), iterations:len, direction:'alternate', easing:'ease-in-out'});
      var cnt = css(h('div', 'mm-cnt', '0', L), 'left:50cqw;top:6cqw;color:' + GREEN);
      var list = css(h('div', 'mm-abs', null, L), 'left:50cqw;right:6cqw;top:17cqw;height:24cqw');
      items.forEach(function(x, i){
        T(2 + i, function(){
          var ok = css(h('div', 'mm-ok', '✓', L), 'left:21cqw;top:19cqw'); pop(ok); R.at(b(B0 + 2.6 + i), function(){ ok.remove(); });
          cnt.textContent = String(i + 1); pop(cnt);
          var r = css(h('div', 'mm-row ok', '<span class="k">' + String(i + 1).padStart(2, '0') + '</span>' + x, list), 'top:' + i * 4.4 + 'cqw'); slideUp(r);
        });
      });
      captions(T, L, o.caps);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 표: 머리줄 + 줄들이 박마다 들어오고 → 한 번에 정렬·매칭(초록) → 강조 */
  TPL.table = function(R, B0, len, o){
    var cols = o.cols || ['이름', '수량', '위치'], rows = o.rows || [['A', '3', 'B-02'], ['B', '1', 'A-01'], ['C', '5', 'C-03'], ['D', '2', 'A-02']], i;
    for (i = 0; i < rows.length; i++) R.hit(B0 + 1 + i / 2, 'arp');
    R.hit(B0 + 4, 'hit');
    for (i = 0; i < rows.length; i++) R.hit(B0 + 5 + i / 2, 'mel', 3 + i);
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#132a52'));
      var tb = h('div', 'mm-tbl', null, L), gt = 'grid-template-columns:repeat(' + cols.length + ',1fr)';
      var hd = css(h('div', 'mm-tr h', cols.map(function(c){ return '<span>' + c + '</span>'; }).join(''), tb), gt + ';top:0'); pop(hd);
      var trs = rows.map(function(r, i){
        var tr = css(h('div', 'mm-tr', r.map(function(c){ return '<span>' + c + '</span>'; }).join(''), tb), gt + ';top:' + (5 + i * 4.6) + 'cqw');
        fly(tr, 'translateX(40cqw)', b(1 + i / 2) - 120, 240); return tr;
      });
      var order = o.order || rows.map(function(r, i){ return i; });
      T(4, function(){ trs.forEach(function(tr, i){ var k = order.indexOf(i);
        tr.animate([{top:tr.style.top}, {top:(5 + k * 4.6) + 'cqw'}], {duration:b(.75), easing:'cubic-bezier(.7,0,.2,1.2)', fill:'forwards'}); }); });
      trs.forEach(function(tr, i){ T(5 + order.indexOf(i) / 2, function(){
        var sp = tr.querySelectorAll('span'); var c = sp[o.mark == null ? sp.length - 1 : o.mark]; c.classList.add(o.markCls || 'ok'); pop(c); }); });
      captions(T, L, o.caps);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 합치기: 파일 아이콘이 사방에서 16분음마다 모이고 → 한 박에 하나로 쾅 */
  TPL.merge = function(R, B0, len, o){
    var n = o.n || 6, i;
    for (i = 0; i < n; i++) R.hit(B0 + 1 + i / 4, 'arp');
    R.hit(B0 + 4, 'hit');
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#1a2d55'));
      var fs = [];
      for (var i = 0; i < n; i++){
        var a = i / n * Math.PI * 2, x = 46 + Math.cos(a) * 30, y = 20 + Math.sin(a) * 14;
        var f = css(h('div', 'mm-file', '<span>' + (o.kind || 'PDF') + '</span>', L), 'left:' + x + 'cqw;top:' + y + 'cqw;--c:' + (o.color || RED));
        pop(f, b(1 + i / 4) - 80); fs.push(f);
      }
      T(3.5, function(){ fs.forEach(function(f){ f.animate([{left:f.style.left, top:f.style.top}, {left:'46cqw', top:'20cqw', opacity:0}], {duration:b(.5), easing:'cubic-bezier(.7,0,.6,1)', fill:'forwards'}); }); });
      T(4, function(){ var big = css(h('div', 'mm-file big', '<span>' + (o.bigLabel || (o.kind || 'PDF') + ' ×' + (o.total || n)) + '</span>', L), 'left:42.5cqw;top:14cqw;--c:' + (o.color || RED)); pop(big); });
      captions(T, L, o.caps);
      tagsAt(T, L, o.tags, len - 3);
    });
  };

  /* 막대 그래프 + 큰 숫자: 막대가 8분음마다 솟고 숫자가 올라감 */
  TPL.chart = function(R, B0, len, o){
    var vals = o.vals || [30, 45, 38, 60, 52, 75, 68, 92], i;
    for (i = 0; i < vals.length; i++) R.hit(B0 + 1 + i / 2, 'mel', i);
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#122a50'));
      var ch = h('div', 'mm-chart', null, L);
      var bars = vals.map(function(v, i){ var e = h('b', i === vals.length - 1 ? 'hi' : '', null, ch); return e; });
      var num = css(h('div', 'mm-cnt', '0', L), 'left:10cqw;top:5cqw;color:' + (o.numColor || '#fff'));
      var unit = css(h('div', 'mm-hv', o.unit || '', L), 'position:absolute;left:10cqw;top:15cqw;font-size:2.6cqw;color:' + BLUE);
      bars.forEach(function(e, i){ T(1 + i / 2, function(){
        e.animate([{height:'0'}, {height:vals[i] + '%'}], {duration:b(.5), easing:'cubic-bezier(.2,1.4,.4,1)', fill:'forwards'});
        num.textContent = o.fmt ? o.fmt(i, vals.length) : Math.round((o.value || 100) * (i + 1) / vals.length).toLocaleString(); }); });
      captions(T, L, o.caps, true);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 실시간 동기화: 폰에서 찍으면 → 신호 4개(16분음) → PC 에 바로 */
  TPL.sync = function(R, B0, len, o){
    for (var i = 0; i < 4; i++) R.hit(B0 + 2 + i / 4, 'arp');
    R.hit(B0 + 3, 'hit');
    scene(R, B0, function(T){
      var L = R.layer('#0b1a33'), px = R.W;
      function grid(dev, cols, rows){ dev.style.gridTemplateColumns = 'repeat(' + cols + ',1fr)'; var bs = []; for (var i = 0; i < cols * rows; i++) bs.push(h('b', null, null, dev)); return bs; }
      var ph = css(h('div', 'mm-dev', null, L), 'left:12cqw;top:15cqw;width:15cqw;height:28cqw;border-radius:2.2cqw'), pb = grid(ph, 3, 6);
      var pc = css(h('div', 'mm-dev', null, L), 'right:10cqw;top:14cqw;width:42cqw;height:25cqw'), cb = grid(pc, 6, 4);
      var base = css(h('div', 'mm-base', null, L), 'right:7cqw;top:39.8cqw;width:48cqw');
      pop(ph); pop(pc, b(.5)); pop(base, b(.5));
      var caps = o.caps || [[1, '폰에서 찍으면,'], [3, 'PC에 <em>바로</em> 뜬다']];
      captions(T, L, caps, true);
      T(1, function(){ var r = css(h('div', 'mm-rip', null, L), 'left:17.5cqw;top:25cqw');
        r.animate([{transform:'scale(.2)', opacity:1}, {transform:'scale(1.8)', opacity:0}], {duration:b(1), iterations:2}); pb[7].classList.add('on'); });
      T(2, function(){ for (var i = 0; i < 4; i++){ var d = css(h('div', 'mm-dot', null, L), 'left:22cqw;top:26cqw');
        d.animate([{transform:'translate(0,0) scale(.6)', opacity:0}, {transform:'translate(' + 16 * px + 'px,' + (-10 * px) + 'px) scale(1)', opacity:1, offset:.5}, {transform:'translate(' + 36 * px + 'px,' + (-1 * px) + 'px) scale(.6)', opacity:0}],
          {duration:b(1), delay:b(i / 4), easing:'ease-in-out', fill:'both'}); } });
      T(3, function(){ cb[9].classList.add('on'); pop(cb[9]); });
      tagsAt(T, L, o.tags || ['실시간 동기화', '설치 없음', '폰·태블릿·PC'], 4);
    });
  };

  /* 말풍선: 폰 화면에 대화가 박마다 톡톡 (사진 말풍선 포함) */
  TPL.chat = function(R, B0, len, o){
    var msgs = o.msgs || [['l', '3번 랙 비었어요'], ['r', '확인! 채울게요'], ['l', 'ph'], ['r', '👍 완료']], i;
    for (i = 0; i < msgs.length; i++) R.hit(B0 + 1 + i, 'mel', 3 + i * 2);
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#1b2b52'));
      var ph = h('div', 'mm-phone', null, L); pop(ph);
      var y = 4;
      msgs.forEach(function(m, i){ T(1 + i, function(){
        var e = h('div', 'mm-bub ' + m[0] + (m[1] === 'ph' ? ' ph' : ''), m[1] === 'ph' ? '' : m[1], ph);
        css(e, 'top:' + y + 'cqw'); y += m[1] === 'ph' ? 11 : 6.5;
        e.animate([{transform:'scale(0)', opacity:0}, {transform:'scale(1.1)', opacity:1, offset:.7}, {transform:'scale(1)', opacity:1}], {duration:260, fill:'both', easing:'cubic-bezier(.2,.9,.3,1.3)'});
        e.style.transformOrigin = m[0] === 'l' ? '0 100%' : '100% 100%';
      }); });
      captions(T, L, o.caps);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 지도: 핀이 8분음마다 떨어지고 선으로 이어짐 */
  TPL.pins = function(R, B0, len, o){
    var P = o.points || [[20, 30], [38, 18], [55, 34], [70, 20], [80, 40], [30, 45]], i;
    for (i = 0; i < P.length; i++) R.hit(B0 + 1 + i / 2, 'arp');
    R.hit(B0 + 5, 'hit');
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#0f2b4a'));
      var mp = h('div', 'mm-map', null, L); pop(mp);
      var svg = '<svg viewBox="0 0 100 56" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%"><polyline points="' + P.map(function(p){ return p[0] + ',' + p[1]; }).join(' ') + '" fill="none" stroke="' + BLUE + '" stroke-width=".5" stroke-dasharray="200" stroke-dashoffset="200"/></svg>';
      var sv = h('div', 'mm-abs', svg, L); css(sv, 'inset:0');
      P.forEach(function(p, i){ T(1 + i / 2, function(){ var e = css(h('div', 'mm-pin', null, L), 'left:' + p[0] + 'cqw;top:' + p[1] + 'cqw');
        e.animate([{transform:'rotate(-45deg) translate(-4cqw,-4cqw)', opacity:0}, {transform:'rotate(-45deg)', opacity:1}], {duration:200, easing:'cubic-bezier(.5,0,.75,1.4)', fill:'both'}); }); });
      T(5, function(){ sv.querySelector('polyline').animate([{strokeDashoffset:200}, {strokeDashoffset:0}], {duration:b(1.5), fill:'forwards'}); });
      captions(T, L, o.caps);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 자물쇠: 비밀번호 점이 16분음마다 → 철컥 잠김 */
  TPL.lock = function(R, B0, len, o){
    var i; for (i = 0; i < 6; i++) R.hit(B0 + 1 + i / 4, 'arp');
    R.hit(B0 + 3, 'hit');
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#2a1a3d'));
      var sh = h('div', 'mm-shk', null, L), lk = h('div', 'mm-lock', null, L); pop(lk); pop(sh);
      sh.style.transform = 'translateY(-4cqw)';
      var pw = h('div', 'mm-pw', '', L);
      for (i = 0; i < 6; i++) (function(i){ T(1 + i / 4, function(){ pw.textContent += '●'; }); })(i);
      T(3, function(){ sh.animate([{transform:'translateY(-4cqw)'}, {transform:'none'}], {duration:160, fill:'forwards', easing:'cubic-bezier(.6,0,.8,1.6)'}); shake(lk); pw.style.color = GREEN; });
      captions(T, L, o.caps, true);
      tagsAt(T, L, o.tags, len - 3);
    });
  };

  /* 캔들 차트: 봉이 8분음마다 그려지며 우상향 → 화살표 */
  TPL.candles = function(R, B0, len, o){
    var N = 12, i; for (i = 0; i < N; i++) R.hit(B0 + 1 + i / 2, 'mel', Math.min(10, Math.floor(i * .8)));
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#0e2a2a'));
      var box = css(h('div', 'mm-abs', null, L), 'left:10cqw;right:10cqw;top:10cqw;bottom:10cqw;border-bottom:.3cqw solid #ffffff44');
      var y = 30;
      for (i = 0; i < N; i++) (function(i){
        var up = (i * 7) % 5 !== 0, hgt = 4 + (i * 13) % 7; y += up ? 2 : -1.2;
        var c = css(h('div', 'mm-cd', null, box), 'left:' + (6 + i * 7.5) + '%;bottom:' + y + '%;height:' + hgt + '%;background:' + (up ? GREEN : RED) + ';visibility:hidden');
        T(1 + i / 2, function(){ c.style.visibility = 'visible'; c.animate([{transform:'scaleY(0)'}, {transform:'scaleY(1)'}], {duration:200, fill:'both'}); });
      })(i);
      captions(T, L, o.caps, true);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 사주 네 기둥: 기둥이 박마다 뒤집혀 나타나고 빛남 */
  TPL.pillars = function(R, B0, len, o){
    var P = o.pillars || [['時', '庚', '午'], ['日', '甲', '子'], ['月', '丙', '寅'], ['年', '戊', '辰']], i;
    for (i = 0; i < 4; i++) R.hit(B0 + 1 + i, 'mel', 2 + i * 2);
    R.hit(B0 + 5, 'hit');
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#25124a'));
      P.forEach(function(p, i){ T(1 + i, function(){
        var e = css(h('div', 'mm-pil', '<small>' + p[0] + '柱</small><b>' + p[1] + '</b><b>' + p[2] + '</b>', L), 'left:' + (16 + i * 18) + 'cqw');
        e.animate([{transform:'perspective(60cqw) rotateY(90deg)', opacity:0}, {transform:'none', opacity:1}], {duration:280, fill:'both', easing:'cubic-bezier(.2,.9,.3,1.2)'}); }); });
      captions(T, L, o.caps, true);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 사진: 뷰파인더 + 박마다 찰칵(번쩍) → 사진이 쌓여 한 장으로 */
  TPL.photo = function(R, B0, len, o){
    var n = o.n || 4, i; for (i = 0; i < n; i++) R.hit(B0 + 1 + i, 'hit');
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#13244a'));
      var vf = h('div', 'mm-vf', null, L);
      [['0', '0', 'border-right:none;border-bottom:none'], ['auto', '0', 'border-left:none;border-bottom:none;right:0'], ['0', 'auto', 'border-right:none;border-top:none;bottom:0'], ['auto', 'auto', 'border-left:none;border-top:none;right:0;bottom:0']]
        .forEach(function(c){ css(h('i', null, null, vf), c[2] + (c[0] === '0' ? ';left:0' : '') + (c[1] === '0' ? ';top:0' : '')); });
      var bx = css(h('div', 'mm-card', null, vf), 'left:12cqw;top:6cqw;width:16cqw;height:16cqw;background:linear-gradient(135deg,#f1c98a,#b8783a)');
      var fl = h('div', 'mm-flash', null, L);
      for (var i = 0; i < n; i++) (function(i){ T(1 + i, function(){
        fl.animate([{opacity:.9}, {opacity:0}], {duration:220});
        var ph = css(h('div', 'mm-card', null, L), 'right:' + (6 + i * 1.2) + 'cqw;top:' + (8 + i * 2.5) + 'cqw;width:14cqw;height:11cqw;border:.6cqw solid #fff;background:linear-gradient(135deg,#f1c98a,#b8783a);transform:rotate(' + (i % 2 ? 6 : -5) + 'deg)');
        fly(ph, 'translate(-30cqw,10cqw) scale(.4)', 0, 260);
      }); })(i);
      captions(T, L, o.caps);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* 규격 맞추기: 큰 종이가 한 박에 라벨 크기로 착 줄어들고 치수 표시 */
  TPL.resize = function(R, B0, len, o){
    for (var i = 0; i < 4; i++) R.hit(B0 + 2 + i, 'hit');
    scene(R, B0, function(T){
      var L = R.layer(grad(o.bg || '#132a52'));
      var pg = css(h('div', 'mm-doc', '<i style="top:3.2cqw"></i><i style="top:4.4cqw;right:3cqw"></i><span class="bc"></span><b>' + (o.from || 'A4') + '</b>', L), 'left:38cqw;top:6cqw;width:24cqw;height:34cqw;--c:' + ORANGE); pop(pg);
      var dim = css(h('div', 'mm-hv', '', L), 'position:absolute;left:0;right:0;bottom:6cqw;text-align:center;font-size:4cqw;color:' + YEL);
      (o.steps || [['A4', 24, 34], ['', 16, 22], ['', 12, 16.8], ['100×140', 10, 14]]).forEach(function(s, i){ T(2 + i, function(){
        pg.animate([{width:pg.style.width, height:pg.style.height}, {width:s[1] + 'cqw', height:s[2] + 'cqw'}], {duration:200, easing:'cubic-bezier(.6,0,.3,1.4)', fill:'forwards'});
        pg.style.width = s[1] + 'cqw'; pg.style.height = s[2] + 'cqw'; pg.style.left = (50 - s[1] / 2) + 'cqw';
        if (s[0]) { pg.querySelector('b').textContent = s[0]; dim.textContent = s[0]; pop(dim); } }); });
      captions(T, L, o.caps, true);
      tagsAt(T, L, o.tags, len - 2);
    });
  };

  /* ═══ 메뉴 등록 · 재생 ═══ */
  var SCENES = {};
  function build(cfg){
    return function(R){
      intro(R, cfg.title, cfg.color || BLUE);
      four(R, cfg.words);
      var h1 = cfg.hero[0], h2 = cfg.hero[1];
      TPL[h1.t](R, 12, 12, h1);
      TPL[h2.t](R, 24, 8, h2);
      checklist(R, cfg.list, cfg.listTitle);
      door(R, cfg.hook && cfg.hook[0], cfg.hook && cfg.hook[1], cfg.open);
      outro(R);
    };
  }

  window.MCMotion = {
    add: function(key, cfg){ SCENES[key] = { run: build(cfg), key: cfg.key || 0 }; },
    has: function(key){ return !!SCENES[key]; },
    /* stage 에 key 장면 재생. 없는 메뉴면 이름 흐르는 자리표시 */
    play: function(key, stage, name, onEnd){
      setup(); this.stop();
      stage.className = 'mm-stage'; stage.innerHTML = ''; stage.style.background = '';
      var R = cur = new Run(stage);
      if (!SCENES[key]){
        stage.innerHTML = '<div class="mm-ph"><span>▶ ' + (name || '') + ' · 프리젠테이션 준비 중 ·</span></div>';
        return 0;
      }
      SCENES[key].run(R);
      R.snd = new Sound();
      if (R.snd.ac) song(R.snd, R.hits, SCENES[key].key);
      var len = Math.round(b(LEN));
      R.at(len, function(){ if (onEnd) onEnd(); });
      return len;
    },
    stop: function(){ if (cur) cur.stop(); cur = null; },
    /* 소리 켜기/끄기 — 재생 중에도 바로 적용, 다음에도 기억 */
    isMuted: function(){ return muted; },
    setMuted: function(m){
      muted = !!m;
      try { localStorage.setItem('mc_motion_mute', muted ? '1' : '0'); } catch (e) {}
      if (cur && cur.snd && cur.snd.master) cur.snd.master.gain.setTargetAtTime(muted ? 0 : VOL, cur.snd.ac.currentTime, .02);
    },
    colors: { NAVY:NAVY, BLUE:BLUE, ORANGE:ORANGE, WHITE:WHITE, RED:RED, YEL:YEL, GREEN:GREEN, PINK:PINK, VIOLET:VIOLET }
  };
})();
