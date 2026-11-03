/* ============================================================
   AI 물류비서 — 픽셀 사무실 (secretary.html 오른쪽 화면, 2026-11-01)

   건물 단면의 하얀 유리방. 비서 1명 = 방 1개이고, 비서가 늘면 층이 늘어난다.
   그림 자체는 데이터를 모른다. secretary_core.officeRooms 가 만든 rooms 를 update 로 받아 그리기만 한다.
   progress(canvas) = 흰 화면 위 진행 막대. 화면이 실제 작업 기록으로 정한 상태만 받아 그린다.
     mode  off = 커튼 닫힘(퇴근) · idle = 대기 · work = 일하는 중 · alert = 방이 붉어짐(문제)
     count 쌓이는 일감 수, say 이름표 글자
============================================================ */
(function(root){
  'use strict';
  var W = 720, FH = 144, TOPY = 30, BASE_H = 62, RW = 336, COL = [16, 368];
  var LINE = '#2a2430';
  /* 인물 그림판 (대표님 2026-11-02: 큰 머리·짧은 몸·굵은 픽셀). 한 칸 = 화면 2픽셀, 글자는 PAL 색. 머리 + 얼굴 + 몸 + 다리를 이어 붙임 */
  var CELL = 2, INK = '#0e0d10', BLINK_SEC = .16;
  var HEADS = {
    short: ['...KKKKKKKKK....', '..KKKKKKKKKKK...', '.KKKKKKKKKKKKK..', '.KKKKKKKKKKKKK..', '.KKKKSSSSSSSKK..', '.KKDSSSSSSSSSK..'],
    swept: ['......KKKKKK....', '..KKKKKKKKKKKK..', '.KKKKKKKKKKKKKK.', '.KKKKKKKKKKKKKK.', '.KKKKKSSSSSSKK..', '.KKDKSSSSSSSSK..'],
    bob: ['...KKKKKKKKK....', '..KKKKKKKKKKK...', '.KKKKKKKKKKKKK..', '.KKKKKKKKKSSKK..', '.KKKKKKSSSSSSK..', '.KKKKSSSSSSSSK..'],
    cap: ['...KKKKKKKKK....', '..KCCCCCCCCCK...', '.KCCCCCCCCCCCK..', '.KCCCCCCCCCCCKKK', '.KEEEEEEEEEEEEEK', '.KKDSSSSSSSSSKKK']
  };
  var FACE = ['.KKSSSSSKSSSKK..', '.KSSSSSSKSSSKK..', '.KSSSSSSKSSSKK..', '..KSSSSSSSSSSK..', '..KKSSSSKKKKKK..', '...KSSSSSSSSK...', '...KKKKKKKKKK...'];
  var FACE_BOB = ['.KKKSSSSKSSSKK..', '.KKKSSSSKSSSKK..', '.KKKSSSSKSSSKK..', '.KKKSSSSSSSSSK..', '.KKKKSSSKKKKKK..', '.KKKKSSSSSSSK...', '..KKKKKKKKKKK...'];
  var BODY = ['..KKTTTTTTTTKK..', '.KTKTTTTTTTTKTK.', '.KTTKTTTTTTKTTK.', '.KSSKTTTTTTKSSK.', '.KSSKUUUUUUKSSK.', '..KKKBBBBBBKKK..'];
  var SUIT = ['..KKTTWKKWTTKK..', '.KTKTTWKKWTTKTK.', '.KTTKTTWWTTKTTK.', '.KSSKTTTTTTKSSK.', '.KSSKUUUUUUKSSK.', '..KKKBBBBBBKKK..'];
  var LEGS = [['....KBBKKBBK....', '...KKKKKKKKKK...', '...KKKKKKKKKK...'], ['...KBBK..KBBK...', '..KKKKK..KKKKK..', '..KKKKK..KKKKK..']];
  var SIT = ['..KKTTTTTTTTK...', '.KTKTTTTTTTTK...', '.KTTKTTTTTTTK...', '.KSSKUUUUUUUK...', '..KKKBBBBBBBBBK.', '....KBBBBBBBBBK.', '....KKKKKKKBBBK.', '..........KBBK..', '..........KBBK..', '.........KKKKKK.', '.........KKKKKK.'];
  var PAL = {
    ceo: { hair: 'swept', suit: 1, S: '#f6b8a6', D: '#d9937f', T: '#3f4149', U: '#2c2e33', B: '#7f8189', W: '#ffffff' },
    head: { hair: 'bob', S: '#f6c0a8', D: '#d9937f', T: '#3f7fd0', U: '#2d5fa3', B: '#e8e8ec' },
    ezadmin: { hair: 'short', S: '#a8623a', D: '#7f4827', T: '#f0b83f', U: '#c58f22', B: '#2d3a66' },
    ebut: { hair: 'cap', S: '#f6b8a6', D: '#d9937f', T: '#3fa877', U: '#2e8259', B: '#6a5a4a', C: '#e88a2c', E: '#b8691f' }
  };
  /* 비서별 자리와 상태별 동작. 새 비서는 여기에 한 줄 + secretary_core.officeRooms 에 한 줄 */
  var CAST = {
    ceo: { seat: 112, desk: 128, script: {
      idle: [{ a: 'sit', t: 3.5, type: 1 }, { a: 'sit', t: 2.4, sip: 1 }, { a: 'walk', x: 240 }, { a: 'stand', t: 3, dir: 1 }, { a: 'walk', x: 112 }],
      alert: [{ a: 'stand', t: 2, dir: 1, sheet: 1 }] } },
    head: { short: '헤드비서', seat: 106, desk: 122, script: {
      idle: [{ a: 'sit', t: 4, type: 1 }, { a: 'walk', x: 228 }, { a: 'stand', t: 2.6, dir: 1, point: 1 }, { a: 'walk', x: 106 }],
      work: [{ a: 'sit', t: 2, type: 1 }, { a: 'walk', x: 228 }, { a: 'stand', t: 1.2, dir: 1, point: 1 }, { a: 'walk', x: 106 }],
      alert: [{ a: 'stand', t: 2, dir: 1, point: 1 }] } },
    ezadmin: { short: '이지어드민', seat: 112, desk: 128, script: {
      idle: [{ a: 'sit', t: 4, sip: 1 }, { a: 'sit', t: 3, type: 1 }],
      work: [{ a: 'sit', t: 2.4, type: 1 }, { a: 'walk', x: 256, sheet: 1 }, { a: 'stand', t: .7, dir: 1 }, { a: 'walk', x: 112 }],
      alert: [{ a: 'stand', t: 2, dir: 1, sheet: 1 }] } },
    ebut: { short: '이벗', seat: 100, script: {
      idle: [{ a: 'stand', t: 3, dir: 1 }, { a: 'walk', x: 170 }, { a: 'stand', t: 2.4, dir: -1 }, { a: 'walk', x: 100 }],
      work: [{ a: 'walk', x: 100 }, { a: 'stand', t: .5, dir: -1 }, { a: 'walk', x: 236, box: 1 }, { a: 'stand', t: .5, dir: 1, box: 1 }],
      alert: [{ a: 'stand', t: 2, dir: 1 }] } }
  };

  /* opts.fps: 사람이 안 보는 상시 컴퓨터는 그리는 횟수를 줄여 부담을 덜음 */
  /* 창밖: 시간대와 날씨. 날씨 코드는 picktalk 와 같은 Open-Meteo WMO 코드 */
  function skyPhase(h){ return h < 5 || h >= 20 ? 'night' : h < 7 ? 'dawn' : h < 11 ? 'morning' : h < 17 ? 'day' : 'evening'; }
  function skyKind(c){
    if (c === 0 || c === 1) return 'clear';
    if (c === 2) return 'partly';
    if (c === 3) return 'cloud';
    if (c === 45 || c === 48) return 'fog';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95 && c <= 99) return 'storm';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    return 'clear';
  }
  var SKY_CLEAR = { dawn: ['#3d4a7a', '#e8a27c'], morning: ['#7fbfe8', '#d8eef8'], day: ['#3f94de', '#a8d6f2'], evening: ['#5a4a86', '#f08a4a'], night: ['#101a3e', '#24417e'] };
  var SKY_GREY = { dawn: ['#5a6078', '#9a93a0'], morning: ['#8b97a8', '#c3cbd5'], day: ['#7f8b9c', '#b7c0cc'], evening: ['#56566e', '#8a7f86'], night: ['#141a2c', '#2a3044'] };
  function mix(a, b, f){
    var p = function(s, i){ return parseInt(s.substr(i, 2), 16); }, out = '#';
    [1, 3, 5].forEach(function(i){ var v = Math.round(p(a, i) + (p(b, i) - p(a, i)) * f).toString(16); out += v.length < 2 ? '0' + v : v; });
    return out;
  }

  /* 그림판 그리기와 머리. 사무실과 진행 막대가 함께 씀 */
  function paintRows(g, rows, x, feet, dir, p, lift){
    var top = feet - rows.length * CELL - (lift || 0);
    rows.forEach(function(row, ry){
      for (var c = 0; c < row.length;) {
        var ch = row[c], e = c + 1;
        while (e < row.length && row[e] === ch) e++;
        if (ch !== '.') {
          var left = dir > 0 ? c * CELL - row.length : row.length - e * CELL;
          g.fillStyle = ch === 'K' ? INK : p[ch];
          g.fillRect(Math.round(x + left), Math.round(top + ry * CELL), (e - c) * CELL, CELL);
        }
        c = e;
      }
    });
  }
  function headOf(p, blink){
    var face = (p.hair === 'bob' ? FACE_BOB : FACE).map(function(row, i){
      return blink && i < 2 ? row.slice(0, 8) + 'S' + row.slice(9, 12) + 'S' + row.slice(13) : row;
    });
    return HEADS[p.hair].concat(face);
  }

  /* 진행 막대: 일하는 비서가 막대 끝에서 달리고, 끝나면 손을 들고 오른쪽으로 나감. 멈추면 막대가 붉어지고 서류를 들고 섬.
     set({ who, state: run|done|stop|off, pct: 0~1 또는 null(단계를 모름) }) — 화면이 실제 작업 기록으로만 부름 */
  var BAR = { run: '#2bb673', done: '#1d6fe8', stop: '#d92b2b' };
  function progress(cv){
    var g = cv.getContext('2d'), Wd = cv.width, Hd = cv.height, BY = Hd - 14, BX = 10, BW = Wd - 20;
    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var S = { who: 'ebut', state: 'off', pct: 0 }, shown = 0, x = BX, leaving = false, gone = false, T = 0, last = 0, raf = 0;
    function r(px, py, w, h, c){ g.fillStyle = c; g.fillRect(Math.round(px), Math.round(py), Math.round(w), Math.round(h)); }
    function figure(px, feet, o){
      var p = PAL[S.who] || PAL.ebut, step = o.walk && Math.sin(T * (o.fast ? 18 : 10)) > 0 ? 1 : 0, lift = o.walk ? (step ? 2 : 0) : 0, y = feet - lift;
      g.globalAlpha = .18; r(px - 13, feet - 1, 26, 2, LINE); g.globalAlpha = 1;
      paintRows(g, headOf(p, false).concat(p.suit ? SUIT : BODY, LEGS[step]), px, feet, 1, p, lift);
      if (o.wave) { r(px + 11, y - 34, 4, 12, INK); r(px + 12, y - 33, 2, 10, p.T); r(px + 10, y - 38, 6, 5, p.S); }
      if (o.sheet) { r(px + 11, y - 29, 14, 17, INK); r(px + 12, y - 28, 12, 15, '#ffffff'); for (var i = 0; i < 3; i++) r(px + 14, y - 25 + i * 4, 8, 1, '#9aa2b3'); }
    }
    function draw(){
      g.clearRect(0, 0, Wd, Hd);
      if (S.state === 'off') return;
      var target = S.state === 'done' ? 1 : S.pct == null ? Math.max(shown, .12) : S.pct;
      shown += (target - shown) * (reduce ? 1 : .08);
      r(BX - 2, BY - 2, BW + 4, 12, INK); r(BX, BY, BW, 8, '#e3e6ec');
      r(BX, BY, BW * shown, 8, BAR[S.state] || BAR.run);
      /* 단계를 모르는 동안은 막대 안 빗금만 흐름 */
      if (S.state === 'run' && !reduce) for (var k = -1; k < BW * shown / 12; k++) { var sx = BX + k * 12 + (T * 24) % 12; if (sx >= BX && sx < BX + BW * shown - 4) r(sx, BY + 1, 4, 6, 'rgba(255,255,255,.35)'); }
      var end = BX + BW * shown;
      if (S.state === 'run') { x += (Math.min(end, BX + BW - 12) - x) * .2; figure(x, BY - 2, { walk: !reduce, fast: true }); }
      else if (S.state === 'stop') { x = Math.min(end, BX + BW - 30); figure(x, BY - 2, { sheet: true }); }
      else if (S.state === 'done' && !gone) {
        if (leaving && !reduce) { x += 1.4; if (x > Wd + 20) gone = true; figure(x, BY - 2, { walk: true, wave: true }); }
        else figure(Math.min(end, BX + BW - 30), BY - 2, { wave: true });
      }
    }
    function frame(n){
      var dt = Math.min(.1, (n - last) / 1000 || 0); last = n; T += dt;
      draw();
      raf = S.state === 'off' || (S.state === 'done' && gone) || reduce ? 0 : requestAnimationFrame(frame);
    }
    function set(next){
      var was = S.state;
      S = { who: next.who || 'ebut', state: next.state || 'off', pct: next.pct == null ? null : Math.max(0, Math.min(1, next.pct)) };
      if (S.state === 'run' && was !== 'run') { shown = 0; x = BX; gone = false; leaving = false; }
      if (S.state === 'done' && was !== 'done') { leaving = was === 'run'; gone = false; if (!leaving) shown = 1; }
      if (S.state !== 'done') { leaving = false; gone = false; }
      if (!raf) raf = requestAnimationFrame(function(n){ last = n; frame(n); });
    }
    return { set: set };
  }

  function mount(sc, opts){
    var minGap = opts && opts.fps ? 1000 / opts.fps : 0;
    var cv = sc.querySelector('canvas'), g = cv.getContext('2d');
    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var P = [], H = 0, T = 0, SKY = { code: 0, hour: null };

    function r(x, y, w, h, c){ g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    /* 부품 목록을 윤곽선 먼저, 색 나중으로 그림 */
    function sprite(parts){
      parts.forEach(function(p){ if (!p[5]) r(p[0] - 1, p[1] - 1, p[2] + 2, p[3] + 2, LINE); });
      parts.forEach(function(p){ r(p[0], p[1], p[2], p[3], p[4]); });
    }
    /* 그림판을 그림. x = 가운데, feet = 바닥선, dir < 0 이면 좌우 반전. 같은 글자가 이어지면 한 번에 칠함 */
    function paint(rows, x, feet, dir, p, lift){ paintRows(g, rows, x, feet, dir, p, lift); }
    /* 눈 깜빡임: 비서마다 주기가 달라 함께 깜빡이지 않고, 가끔 두 번 연달아 깜빡임 */
    function blinking(t, seat){
      if (reduce) return false;
      var period = 2.6 + (seat % 7) * .25, n = Math.floor(t / period), at = t - n * period;
      return at < BLINK_SEC || (n % 3 === 2 && at >= BLINK_SEC * 2 && at < BLINK_SEC * 3);
    }
    /* 머리 + 얼굴. 감은 눈 = 양쪽 눈의 위 두 칸을 살색으로 덮어 아래 한 칸만 남김 */
    function headRows(p, blink){ return headOf(p, blink); }
    function shadow(x, feet, w){ g.globalAlpha = .18; r(x - w / 2, feet - 1, w, 2, LINE); g.globalAlpha = 1; }
    /* 윤곽선 있는 네모 */
    function boxed(x, y, w, h, c){ r(x - 1, y - 1, w + 2, h + 2, INK); r(x, y, w, h, c); }
    function standing(x, feet, dir, p, o){
      var t = o.t, frame = o.walk && Math.sin(t * 10) > 0 ? 1 : 0, lift = o.walk ? (frame ? 2 : 0) : 0, y = feet - lift;
      shadow(x, feet, 26);
      paint(headRows(p, o.blink).concat(p.suit ? SUIT : BODY, LEGS[frame]), x, feet, dir, p, lift);
      if (o.box) {
        var bx = dir > 0 ? x + 4 : x - 26;
        boxed(bx, y - 26, 22, 18, '#d1a26c'); r(bx + 9, y - 26, 4, 18, '#efddb4');
        r(dir > 0 ? bx - 2 : bx + 20, y - 18, 4, 4, p.S);
      } else if (o.sheet) {
        var sx = dir > 0 ? x + 12 : x - 24;
        boxed(sx, y - 28, 12, 15, '#ffffff');
        for (var i = 0; i < 3; i++) r(sx + 2, y - 25 + i * 4, 8, 1, '#9aa2b3');
        r(dir > 0 ? sx - 2 : sx + 10, y - 18, 4, 4, p.S);
      } else if (o.point) {
        var ax = dir > 0 ? x + 12 : x - 26;
        boxed(ax, y - 22, 14, 4, p.U);
        r(dir > 0 ? ax + 14 : ax - 4, y - 23, 4, 6, p.S);
      }
    }
    function chair(x, feet){
      r(x - 13, feet - 30, 5, 20, '#3b404b'); r(x - 13, feet - 30, 5, 2, '#59606f'); r(x - 13, feet - 13, 20, 4, '#3b404b');
      r(x - 3, feet - 9, 3, 7, '#7a8190'); r(x - 11, feet - 3, 20, 2, '#7a8190'); r(x - 11, feet - 2, 2, 2, '#3b404b'); r(x + 7, feet - 2, 2, 2, '#3b404b');
    }
    function sitting(x, feet, dir, p, o){
      paint(headRows(p, o.blink).concat(SIT), x, feet, dir, p);
    }
    /* 앉은 인물의 팔은 책상 위에 올라오므로 책상 다음에 그림 */
    function seatedArm(x, feet, p, o){
      var t = o.t;
      if (o.type) {
        var up = !reduce && Math.sin(t * 17) > 0 ? 2 : 0;
        boxed(x + 12, feet - 25 - up, 14, 4, p.U);
        r(x + 26, feet - 26 - up, 4, 5, p.S);
      } else if (o.sip) {
        boxed(x + 12, feet - 25, 8, 4, p.U);
        boxed(x + 18, feet - 37, 8, 12, '#ffffff'); r(x + 19, feet - 36, 6, 2, '#6b472d');
        r(x + 16, feet - 29, 4, 4, p.S);
      }
    }
    function desk(x, feet, on, t){
      r(x, feet - 24, 92, 5, '#a56a3a'); r(x, feet - 19, 92, 3, '#6e4526'); r(x + 3, feet - 16, 4, 16, '#4a3424'); r(x + 85, feet - 16, 4, 16, '#4a3424');
      r(x + 8, feet - 27, 22, 3, '#2c2f3a');
      boxed(x + 36, feet - 52, 30, 22, '#23262e'); r(x + 38, feet - 50, 26, 18, on ? '#6fc6e8' : '#59606f');
      if (on) { var f = Math.floor(t * 5) % 4; for (var i = 0; i < 3; i++) r(x + 41, feet - 47 + i * 5, 8 + ((f + i * 3) % 10), 2, '#2d6c8c'); }
      r(x + 48, feet - 30, 6, 6, '#23262e');
    }
    function labels(x, feet, n){
      if (!n) return;
      var h = n * 3, i;
      sprite([[x, feet - h, 26, h, '#fff']]);
      for (i = 0; i < n; i++) { r(x, feet - 3 - i * 3, 26, 1, '#cfd3da'); r(x + 2, feet - 2 - i * 3, 7, 2, '#f39a3d'); }
    }
    /* 소품. 자리에 고정된 장식이고 데이터와 상관없음 */
    function cardBox(x, y, w, h){ boxed(x, y, w, h, '#d1a26c'); r(x + w / 2 - 2, y, 4, h, '#efddb4'); r(x + w - 9, y + h - 5, 6, 3, '#ffffff'); }
    function rack(x, feet){
      r(x, feet - 76, 3, 76, '#2d5fa3'); r(x + 58, feet - 76, 3, 76, '#2d5fa3');
      [-52, -26, -2].forEach(function(d, i){ r(x, feet + d, 61, 3, '#e88a2c'); cardBox(x + 5, feet + d - 14, 18, 14); if (i !== 1) cardBox(x + 28, feet + d - 18, 22, 18); });
    }
    function plant(x, feet){
      boxed(x, feet - 14, 14, 14, '#e8e4da');
      [[2, -26, 10, 12], [-3, -22, 8, 8], [10, -22, 8, 8], [3, -34, 8, 8]].forEach(function(l){ r(x + l[0], feet + l[1], l[2], l[3], '#5fae4a'); r(x + l[0], feet + l[1], l[2], 2, '#7fce62'); });
    }
    function bookshelf(x, feet){
      boxed(x, feet - 62, 44, 62, '#6e4526');
      [-50, -30, -10].forEach(function(d, i){
        r(x + 2, feet + d + 8, 40, 2, '#4a3424');
        ['#d05a3f', '#3f7fd0', '#3fa877', '#f0b83f'].forEach(function(c, j){ if ((i + j) % 3) r(x + 5 + j * 7, feet + d - 5, 5, 13, c); });
      });
    }
    function cabinet(x, feet){
      boxed(x, feet - 44, 26, 44, '#9aa0ad');
      [-40, -20].forEach(function(d){ r(x + 3, feet + d, 20, 18, '#b5bac5'); r(x + 10, feet + d + 8, 6, 2, '#3a3f4e'); });
    }
    function copier(x, feet){
      boxed(x, feet - 36, 34, 36, '#d9dce3'); r(x + 3, feet - 30, 28, 4, '#3a3f4e'); r(x + 3, feet - 22, 28, 8, '#b5bac5'); r(x + 3, feet - 11, 28, 8, '#b5bac5'); r(x + 26, feet - 36, 4, 3, '#4ad07a');
    }
    function stripes(x, feet){
      for (var i = 0; i < 4; i++) { r(x, feet - 32 + i * 8, 22, 4, i % 2 ? '#23262e' : '#f0c23f'); r(x, feet - 28 + i * 8, 22, 4, i % 2 ? '#f0c23f' : '#23262e'); }
    }
    /* 창밖 */
    function skyWindow(x, y, w, h, t, seed){
      var hour = SKY.hour == null ? (new Date(Date.now() + 9 * 3600000)).getUTCHours() : SKY.hour, phase = skyPhase(hour), kind = skyKind(SKY.code);
      var grey = kind !== 'clear' && kind !== 'partly', pal = (grey ? SKY_GREY : SKY_CLEAR)[phase], dark = phase === 'night' || phase === 'evening' || phase === 'dawn';
      /* 창 안으로 잘라서 그림 */
      function c(px, py, pw, ph, col){
        var l = Math.max(x, px), tp = Math.max(y, py), rt = Math.min(x + w, px + pw), bt = Math.min(y + h, py + ph);
        if (rt > l && bt > tp) r(l, tp, rt - l, bt - tp, col);
      }
      r(x - 1, y - 1, w + 2, h + 2, INK);
      for (var band = 0; band < 6; band++) c(x, y + band * h / 6, w, h / 6 + 1, mix(pal[0], pal[1], band / 5));
      if (kind === 'clear' || kind === 'partly') {
        if (phase === 'night') {
          for (var st = 0; st < 12; st++) c(x + (st * 37 + seed * 13) % w, y + 4 + (st * 23 + seed) % (h / 2), 2, 2, '#e8ecff');
          c(x + w * .72, y + 8, 12, 12, '#f4edc9'); c(x + w * .72 + 4, y + 6, 12, 12, pal[0]);
        } else {
          var sx = phase === 'day' ? .5 : phase === 'evening' ? .8 : .2, sy = phase === 'day' ? .12 : phase === 'morning' ? .28 : .42, sun = phase === 'evening' ? '#ffb45a' : phase === 'dawn' ? '#ffc98a' : '#ffe680';
          c(x + w * sx - 6, y + h * sy, 14, 14, sun); c(x + w * sx - 8, y + h * sy + 3, 18, 8, sun); c(x + w * sx - 3, y + h * sy - 2, 8, 18, sun);
        }
      }
      if (kind !== 'clear') {
        var drift = reduce ? 0 : t * 2, cloud = grey ? mix(pal[0], '#d9dde4', .35) : (phase === 'night' ? '#3a4668' : '#ffffff');
        for (var cl = 0; cl < (grey ? 4 : 2); cl++) {
          var cx = x + ((cl * 53 + seed * 17 + drift) % (w + 30)) - 20, cy = y + 4 + cl * 6;
          c(cx, cy + 3, 30, 7, cloud); c(cx + 6, cy, 16, 4, cloud);
        }
      }
      var tall = [10, 24, 14, 30, 18, 26, 12, 22], bld = dark ? '#1a2c5c' : grey ? '#6a7486' : '#5c6f8f', lit = dark ? '#ffd76b' : '#b8d0e6';
      for (var i = 0, cx = x; cx < x + w - 2; i++) {
        var bw = Math.min(18, x + w - cx), bh = tall[i % 8] + h / 3;
        r(cx, y + h - bh, bw - 2, bh, bld);
        for (var a = 3; a < bw - 4; a += 5) for (var b = 4; b < bh - 3; b += 7) if ((a * 7 + b * 3 + i) % 4 === 0) r(cx + a, y + h - bh + b, 2, 3, lit);
        cx += bw;
      }
      if (kind === 'fog') { g.globalAlpha = .55; for (var f = 0; f < 3; f++) c(x, y + h * .35 + f * h * .22, w, h * .12, '#e6e9ee'); g.globalAlpha = 1; }
      if (kind === 'rain' || kind === 'storm') {
        var fall = reduce ? 0 : t * 90;
        for (var d = 0; d < 16; d++) c(x + (d * 19 + seed * 7) % w, y + ((d * 29 + fall) % (h + 8)) - 6, 1, 6, '#c5d8ee');
      }
      if (kind === 'storm' && !reduce && t % 7 < .12) { g.globalAlpha = .6; c(x, y, w, h, '#ffffff'); g.globalAlpha = 1; }
      if (kind === 'snow') {
        var down = reduce ? 0 : t * 16;
        for (var n = 0; n < 16; n++) c(x + (n * 23 + seed * 5 + (reduce ? 0 : Math.sin(t + n) * 3)) % w, y + ((n * 31 + down) % (h + 4)) - 2, 2, 2, '#ffffff');
      }
      r(x, y, w, 3, '#c9d0dc');
      for (var k = x + w / 3; k < x + w - 2; k += w / 3) r(k, y, 2, h, '#3a3f4e');
    }
    /* 로그인이 풀리면 비서 옆에 뜨는 말풍선. 비밀번호는 모양만 그림 */
    function loginBubble(x, y, c){
      boxed(x, y, 62, 20, '#ffffff'); r(x + 6, y + 4, 12, 12, c); r(x + 8, y + 20, 6, 4, '#ffffff');
      g.font = '12px "Malgun Gothic",sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#3a3f4e'; g.fillText('****', x + 24, y + 11);
    }
    function lamps(x, y, n){
      sprite([[x, y, 76, 34, '#2e3138']]);
      for (var i = 0; i < 3; i++) r(x + 8 + i * 22, y + 11, 16, 12, i < n ? '#6fdc9b' : '#59606f');
    }
    function roomShell(R){
      r(R.x, R.y, R.w, R.h, '#7b8296');
      for (var i = 0; i < R.w; i += 48) r(R.x + i, R.y + 10, 1, R.floor - R.y - 10, '#6f7689');
      r(R.x, R.y, R.w, 8, '#50566a');
      for (var j = 0; j < 2; j++) { r(R.x + 70 + j * 150, R.y + 8, 46, 3, '#3a3f4e'); r(R.x + 72 + j * 150, R.y + 11, 42, 4, '#ffeaa8'); }
      r(R.x, R.floor, R.w, R.h - (R.floor - R.y), '#a3a7b3'); r(R.x, R.floor, R.w, 2, '#c9ccd6');
    }
    function glass(R){
      r(R.x - 2, R.y, 3, R.h, '#2e3138'); r(R.x + R.w - 1, R.y, 3, R.h, '#2e3138'); r(R.x, R.y, R.w, 3, '#2e3138');
    }
    /* 대표실 벽 출근 현황판: 파랑 = 출근(접속), 빨강 = 퇴근(미접속) */
    function attendance(x, y){
      var staff = P.filter(function(o){ return o.id !== 'ceo'; }), h = 12 + staff.length * 15;
      sprite([[x, y, 92, h, '#2e3138']]);
      g.font = '12px "Do Hyeon","Malgun Gothic",sans-serif';
      g.textBaseline = 'middle';
      staff.forEach(function(o, i){
        var ly = y + 7 + i * 15, on = o.mode !== 'off';
        g.fillStyle = '#e8ecf0';
        g.fillText(CAST[o.id].short, x + 7, ly + 6);
        r(x + 70, ly + 1, 12, 10, '#1b1e24');
        r(x + 71, ly + 2, 10, 8, on ? '#3b82f6' : '#e5483b');
        r(x + 72, ly + 3, 3, 2, on ? '#b9d4ff' : '#ffc4bd');
      });
    }
    /* 퇴근: 커튼을 친 방 */
    function curtain(R){
      r(R.x, R.y + 3, R.w, R.floor - R.y - 3, '#59606f');
      for (var x = 0; x < R.w; x += 14) { r(R.x + x, R.y + 3, 3, R.floor - R.y - 3, '#474d5a'); r(R.x + x + 7, R.y + 3, 1, R.floor - R.y - 3, '#6b7382'); }
      r(R.x, R.y + 3, R.w, 5, '#2e3138');
    }
    /* 방 위 띠: 일하는 중이면 흐르고, 문제면 붉게 */
    function band(o, t){
      var R = o.R;
      if (o.mode === 'work') {
        r(R.x, R.y + 3, R.w, 4, '#d6efe2');
        var w = 70, pos = reduce ? 0 : (t * 90) % (R.w + w) - w, a = Math.max(0, pos), b = Math.min(R.w, pos + w);
        if (b > a) r(R.x + a, R.y + 3, b - a, 4, '#34b37e');
      } else if (o.mode === 'alert') r(R.x, R.y + 3, R.w, 4, '#d8543f');
    }
    /* 건물 아래 컨베이어: 실제로 일하는 비서가 있을 때만 움직임 */
    function conveyor(y){
      var on = !reduce && P.some(function(o){ return o.mode === 'work'; });
      r(30, y + 34, W - 60, 18, '#23262e'); r(30, y + 34, W - 60, 3, '#7b8296');
      for (var i = 0; i < 33; i++) r(34 + i * 20 + (on ? T * 30 % 20 : 0), y + 44, 6, 6, '#555b68');
      for (var b = 0; b < 4; b++) cardBox(on ? (T * 30 + b * 170) % 640 + 40 : 90 + b * 160, y + 12, 30, 22);
    }
    /* 맨 윗줄: 지금 상태를 글자로. 실제 rooms 로만 계산 */
    function topBar(){
      r(0, 0, W, TOPY - 4, '#23262e');
      var bad = P.filter(function(o){ return o.mode === 'alert'; }).length, busy = P.some(function(o){ return o.mode === 'work'; }), off = P.some(function(o){ return o.mode === 'off'; });
      g.font = '15px "Do Hyeon","Malgun Gothic",sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff'; g.fillText('AI 물류비서', 14, 14);
      r(104, 9, 8, 8, off || bad ? '#e5483b' : busy ? '#34b37e' : '#4ad07a');
      g.fillStyle = '#c9d0dc'; g.fillText(off ? '상시 컴퓨터 꺼짐' : bad ? '확인 필요 ' + bad + '건' : busy ? '작업 중' : '대기 중', 118, 14);
    }
    function building(){
      r(0, 0, W, H, '#2c2f3a');
      topBar();
      var floors = Math.ceil(P.length / 2), by = TOPY + floors * FH - 4;
      r(0, by, W, H - by, '#3a3f4e');
      conveyor(by);
    }
    function scriptOf(o){ var s = CAST[o.id].script; return s[o.mode] || s.idle || []; }
    function step(o, dt){
      var list = scriptOf(o); if (!list.length) return;
      var s = list[o.i % list.length], seat = CAST[o.id].seat;
      /* 걷던 중 상태가 바뀌면 앉는 동작이 자리 밖에서 시작됨. 자리까지 걸어간 뒤 앉음 */
      if (s.a === 'walk' || (s.a === 'sit' && o.x !== seat)) {
        var to = s.a === 'walk' ? s.x : seat, d = to - o.x, st = (o.mode === 'work' ? 66 : 44) * dt;
        o.dir = d >= 0 ? 1 : -1;
        if (Math.abs(d) <= st) {
          o.x = to;
          if (s.a === 'walk') { o.i = (o.i + 1) % list.length; o.t0 = 0; }
        } else o.x += (d > 0 ? 1 : -1) * st;
      } else {
        o.t0 += dt;
        if (s.dir) o.dir = s.dir;
        if (o.t0 >= s.t) { o.i = (o.i + 1) % list.length; o.t0 = 0; }
      }
    }
    function drawRoom(o, t){
      var R = o.R, F = R.floor, c = CAST[o.id];
      roomShell(R);
      if (o.mode === 'off') { curtain(R); band(o, t); glass(R); return; }
      var list = scriptOf(o), s = list[o.i % list.length] || { a: 'stand', t: 1 }, seated = s.a === 'sit' && o.x === c.seat, X = R.x + Math.round(o.x);
      if (o.id === 'ceo') { skyWindow(R.x + 60, R.y + 36, 120, 56, t, 1); attendance(R.x + 236, R.y + 36); bookshelf(R.x + 8, F); plant(R.x + 62, F); }
      if (o.id === 'head') { skyWindow(R.x + 56, R.y + 36, 130, 56, t, 2); lamps(R.x + 240, R.y + 36, o.count); cabinet(R.x + 8, F); plant(R.x + 40, F); copier(R.x + 246, F); plant(R.x + 296, F); }
      if (o.id === 'ezadmin') { skyWindow(R.x + 62, R.y + 36, 80, 50, t, 3); plant(R.x + 10, F); cabinet(R.x + 302, F); labels(R.x + 40, F, Math.min(14, o.count)); labels(R.x + 68, F, Math.min(14, Math.max(0, o.count - 14))); }
      if (o.id === 'ebut') { skyWindow(R.x + 96, R.y + 36, 130, 50, t, 4); stripes(R.x + 8, F); cardBox(R.x + 34, F - 20, 28, 20); cardBox(R.x + 38, F - 36, 22, 16); rack(R.x + 266, F); }
      if (c.desk) chair(R.x + c.seat, F);
      if (c.desk && !seated) desk(R.x + c.desk, F, true, t);
      var blink = blinking(t, c.seat);
      if (seated) sitting(X, F, 1, PAL[o.id], { blink: blink });
      else standing(X, F, s.a === 'stand' && s.dir ? s.dir : o.dir, PAL[o.id], { t: t + c.seat, blink: blink, walk: (s.a === 'walk' || s.a === 'sit') && !reduce, box: s.box, sheet: s.sheet, point: s.point });
      if (c.desk && seated) { desk(R.x + c.desk, F, true, t); seatedArm(X, F, PAL[o.id], { t: t + c.seat, type: s.type, sip: s.sip }); }
      if (o.mode === 'alert') {
        g.globalAlpha = .16; r(R.x, R.y, R.w, F - R.y, '#d8543f'); g.globalAlpha = 1;
        if (/로그인/.test(o.say)) loginBubble(X + 20, F - 76, o.id === 'ebut' ? '#e88a2c' : '#3f7fd0');
      }
      band(o, t);
      glass(R);
    }
    function draw(){ building(); P.forEach(function(o){ drawRoom(o, T); }); }

    function layout(rooms){
      var floors = Math.ceil(rooms.length / 2);
      H = TOPY + floors * FH + BASE_H;
      cv.width = W; cv.height = H;
      g.imageSmoothingEnabled = false;
      Array.prototype.slice.call(sc.querySelectorAll('.plate')).forEach(function(n){ n.remove(); });
      P = rooms.map(function(m, i){
        var col = i % 2, fl = Math.floor(i / 2), c = CAST[m.id];
        var o = { id: m.id, mode: m.mode, i: 0, t0: 0, x: c.seat, dir: 1, count: 0,
          R: { x: COL[col], y: TOPY + fl * FH, w: RW, h: FH - 6, floor: TOPY + fl * FH + FH - 14 } };
        o.el = document.createElement('div');
        o.el.className = 'plate';
        o.el.style.left = (o.R.x / W * 100) + '%';
        o.el.style.top = ((o.R.y + 7) / H * 100) + '%';
        sc.appendChild(o.el);
        return o;
      });
    }
    function update(rooms){
      if (rooms.length !== P.length) layout(rooms);
      rooms.forEach(function(m, i){
        var o = P[i];
        if (o.mode !== m.mode) { o.mode = m.mode; o.i = 0; o.t0 = 0; }
        o.count = m.count || 0;
        o.say = m.say || '';
        o.el.className = 'plate ' + m.mode;
        o.el.textContent = '';
        o.el.appendChild(document.createTextNode(m.name));
        var b = document.createElement('b'); b.textContent = m.say; o.el.appendChild(b);
      });
      draw();
    }

    var last = 0;
    function frame(n){
      if (minGap && n - last < minGap) { requestAnimationFrame(frame); return; }
      var dt = Math.min(minGap ? .5 : .1, (n - last) / 1000);
      last = n;
      if (P.length) {
        if (!reduce) { T += dt; P.forEach(function(o){ if (o.mode !== 'off') step(o, dt); }); }
        draw();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(function(n){ last = n; frame(n); });
    /* 지금 위치와 자세 (시험용) */
    function peek(){
      return P.map(function(o){
        var list = scriptOf(o), st = list[o.i % list.length] || {};
        return { id: o.id, x: o.x, seated: o.mode !== 'off' && st.a === 'sit' && o.x === CAST[o.id].seat };
      });
    }
    /* 날씨 코드 변경. hour 를 주면 그 시각으로 고정 (시험용) */
    function setSky(code, hour){ SKY.code = Number(code) || 0; SKY.hour = hour == null ? null : hour; }
    return { update: update, peek: peek, setSky: setSky };
  }

  root.SECRETARY_OFFICE = { progress: progress, mount: mount, skyPhase: skyPhase, skyKind: skyKind, SPRITES: { HEADS: HEADS, FACE: FACE, FACE_BOB: FACE_BOB, BODY: BODY, SUIT: SUIT, LEGS: LEGS, SIT: SIT } };
})(window);
