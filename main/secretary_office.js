/* ============================================================
   AI 물류비서 — 픽셀 사무실 (secretary.html 오른쪽 화면, 2026-11-01)

   건물 단면의 하얀 유리방. 비서 1명 = 방 1개이고, 비서가 늘면 층이 늘어난다.
   그림 자체는 데이터를 모른다. secretary_core.officeRooms 가 만든 rooms 를 update 로 받아 그리기만 한다.
     mode  off = 커튼 닫힘(퇴근) · idle = 대기 · work = 일하는 중 · alert = 방이 붉어짐(문제)
     count 쌓이는 일감 수, say 이름표 글자
============================================================ */
(function(root){
  'use strict';
  var W = 720, FH = 100, TOPY = 30, RW = 336, COL = [16, 368];
  var LINE = '#2a2430';
  /* 인물 그림판 (대표님 2026-11-02: 큰 머리·짧은 몸·굵은 픽셀). 한 칸 = 화면 2픽셀, 글자는 PAL 색. 머리 + 얼굴 + 몸 + 다리를 이어 붙임 */
  var CELL = 2, INK = '#0e0d10';
  var HEADS = {
    short: ['...KKKKKKKKK....', '..KKKKKKKKKKK...', '.KKKKKKKKKKKKK..', '.KKKKKKKKKKKKK..', '.KKKKSSSSSSSKK..', '.KKDSSSSSSSSSK..'],
    swept: ['......KKKKKK....', '..KKKKKKKKKKKK..', '.KKKKKKKKKKKKKK.', '.KKKKKKKKKKKKKK.', '.KKKKKSSSSSSKK..', '.KKDKSSSSSSSSK..'],
    bob: ['...KKKKKKKKK....', '..KKKKKKKKKKK...', '.KKKKKKKKKKKKK..', '.KKKKKKKKKSSKK..', '.KKKKKKSSSSSSK..', '.KKKKSSSSSSSSK..'],
    bun: ['......KKKK......', '.....KKKKKK.....', '.....KKKKKK.....', '....KKKKKKKKK...', '.KKKKKKKKKKKKK..', '.KKKKKKKKKKKKK..', '.KKKKSSSSSSSKK..', '.KDSSSSSSSSSSK..', '.KSSSSSSSSSSSK..']
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
    ebut: { hair: 'bun', S: '#f6b8a6', D: '#d9937f', T: '#3fa877', U: '#2e8259', B: '#6a5a4a' }
  };
  /* 비서별 자리와 상태별 동작. 새 비서는 여기에 한 줄 + secretary_core.officeRooms 에 한 줄 */
  var CAST = {
    ceo: { seat: 86, desk: 102, script: {
      idle: [{ a: 'sit', t: 3.5, type: 1 }, { a: 'sit', t: 2.4, sip: 1 }, { a: 'walk', x: 200 }, { a: 'stand', t: 3, dir: 1 }, { a: 'walk', x: 86 }],
      alert: [{ a: 'stand', t: 2, dir: 1, sheet: 1 }] } },
    head: { short: '헤드비서', seat: 86, desk: 102, script: {
      idle: [{ a: 'sit', t: 4, type: 1 }, { a: 'walk', x: 208 }, { a: 'stand', t: 2.6, dir: 1, point: 1 }, { a: 'walk', x: 86 }],
      work: [{ a: 'sit', t: 2, type: 1 }, { a: 'walk', x: 208 }, { a: 'stand', t: 1.2, dir: 1, point: 1 }, { a: 'walk', x: 86 }],
      alert: [{ a: 'stand', t: 2, dir: 1, point: 1 }] } },
    ezadmin: { short: '이지어드민', seat: 106, desk: 122, script: {
      idle: [{ a: 'sit', t: 4, sip: 1 }, { a: 'sit', t: 3, type: 1 }],
      work: [{ a: 'sit', t: 2.4, type: 1 }, { a: 'walk', x: 256, sheet: 1 }, { a: 'stand', t: .7, dir: 1 }, { a: 'walk', x: 106 }],
      alert: [{ a: 'stand', t: 2, dir: 1, sheet: 1 }] } },
    ebut: { short: '이벗', seat: 60, script: {
      idle: [{ a: 'stand', t: 3, dir: 1 }, { a: 'walk', x: 130 }, { a: 'stand', t: 2.4, dir: -1 }, { a: 'walk', x: 60 }],
      work: [{ a: 'walk', x: 60 }, { a: 'stand', t: .5, dir: -1 }, { a: 'walk', x: 214, box: 1 }, { a: 'stand', t: .5, dir: 1, box: 1 }],
      alert: [{ a: 'stand', t: 2, dir: 1 }] } }
  };

  function mount(sc){
    var cv = sc.querySelector('canvas'), g = cv.getContext('2d');
    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var P = [], H = 0, T = 0;

    function r(x, y, w, h, c){ g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    /* 부품 목록을 윤곽선 먼저, 색 나중으로 그림 */
    function sprite(parts){
      parts.forEach(function(p){ if (!p[5]) r(p[0] - 1, p[1] - 1, p[2] + 2, p[3] + 2, LINE); });
      parts.forEach(function(p){ r(p[0], p[1], p[2], p[3], p[4]); });
    }
    /* 그림판을 그림. x = 가운데, feet = 바닥선, dir < 0 이면 좌우 반전. 같은 글자가 이어지면 한 번에 칠함 */
    function paint(rows, x, feet, dir, p, lift){
      var top = feet - rows.length * CELL - (lift || 0);
      rows.forEach(function(row, ry){
        for (var c = 0; c < row.length;) {
          var ch = row[c], e = c + 1;
          while (e < row.length && row[e] === ch) e++;
          if (ch !== '.') {
            var left = dir > 0 ? c * CELL - row.length : row.length - e * CELL;
            r(x + left, top + ry * CELL, (e - c) * CELL, CELL, ch === 'K' ? INK : p[ch]);
          }
          c = e;
        }
      });
    }
    /* 머리 + 얼굴. 눈 깜빡임은 앞쪽 눈 위 두 칸을 살색으로 덮음 */
    function headRows(p, blink){
      var face = (p.hair === 'bob' ? FACE_BOB : FACE).map(function(row, i){ return blink && i < 2 ? row.slice(0, 8) + 'S' + row.slice(9) : row; });
      return HEADS[p.hair].concat(face);
    }
    function shadow(x, feet, w){ g.globalAlpha = .18; r(x - w / 2, feet - 1, w, 2, LINE); g.globalAlpha = 1; }
    /* 윤곽선 있는 네모 */
    function boxed(x, y, w, h, c){ r(x - 1, y - 1, w + 2, h + 2, INK); r(x, y, w, h, c); }
    function standing(x, feet, dir, p, o){
      var t = o.t, frame = o.walk && Math.sin(t * 10) > 0 ? 1 : 0, lift = o.walk ? (frame ? 2 : 0) : 0, y = feet - lift, blink = t % 3.7 < .13;
      shadow(x, feet, 26);
      paint(headRows(p, blink).concat(p.suit ? SUIT : BODY, LEGS[frame]), x, feet, dir, p, lift);
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
      var t = o.t, blink = t % 3.7 < .13;
      paint(headRows(p, blink).concat(SIT), x, feet, dir, p);
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
      r(x, feet - 22, 64, 4, '#c98a52'); r(x, feet - 18, 64, 2, '#9a6638'); r(x + 3, feet - 16, 3, 16, '#555b68'); r(x + 58, feet - 16, 3, 16, '#555b68');
      r(x + 6, feet - 25, 20, 3, '#3b404b');
      sprite([[x + 30, feet - 48, 28, 20, '#2e3138']]); r(x + 32, feet - 46, 24, 16, on ? '#bfe6f3' : '#59606f');
      if (on) { var f = Math.floor(t * 5) % 4; for (var i = 0; i < 3; i++) r(x + 34, feet - 44 + i * 4, 8 + ((f + i * 3) % 10), 1, '#4d6b82'); }
      r(x + 42, feet - 28, 4, 6, '#2e3138'); r(x + 37, feet - 23, 14, 1, '#2e3138');
    }
    function labels(x, feet, n){
      if (!n) return;
      var h = n * 3, i;
      sprite([[x, feet - h, 26, h, '#fff']]);
      for (i = 0; i < n; i++) { r(x, feet - 3 - i * 3, 26, 1, '#cfd3da'); r(x + 2, feet - 2 - i * 3, 7, 2, '#f39a3d'); }
    }
    function boxAt(x, y){ sprite([[x, y, 20, 16, '#d1a26c']]); r(x + 8, y, 4, 16, '#efddb4'); r(x, y, 20, 2, '#e6bd88'); }
    function shelf(x, feet, n){
      r(x, feet - 70, 3, 70, '#555b68'); r(x + 70, feet - 70, 3, 70, '#555b68'); r(x, feet - 36, 73, 3, '#555b68'); r(x, feet - 3, 73, 3, '#555b68');
      for (var i = 0; i < n; i++) { var row = i < 3 ? 0 : 1, c = i < 3 ? i : i - 3; boxAt(x + 5 + c * 22, feet - 3 - (row ? 36 : 0) - 16); }
    }
    function lamps(x, y, n){
      sprite([[x, y, 76, 34, '#2e3138']]);
      for (var i = 0; i < 3; i++) r(x + 8 + i * 22, y + 11, 16, 12, i < n ? '#6fdc9b' : '#59606f');
    }
    function roomShell(R){
      r(R.x, R.y, R.w, R.h, '#fbfcfb');
      r(R.x, R.y, R.w, 6, '#eef2f1');
      r(R.x, R.floor, R.w, R.h - (R.floor - R.y), '#c9553f'); r(R.x, R.floor, R.w, 2, '#e27a60');
      r(R.x, R.floor - 4, R.w, 4, '#e7ecec');
    }
    function shine(R){
      g.globalAlpha = .3;
      for (var k = 0; k < 3; k++) { var bx = R.x + 30 + k * 110; for (var i = 0; i < R.floor - 4 - R.y; i += 1) r(bx + (R.floor - R.y - i) * .45, R.y + i, k === 1 ? 26 : 12, 1, '#cfe7ee'); }
      g.globalAlpha = 1;
    }
    function glass(R){
      r(R.x - 2, R.y, 3, R.h, '#2e3138'); r(R.x + R.w - 1, R.y, 3, R.h, '#2e3138'); r(R.x, R.y, R.w, 3, '#2e3138');
      g.globalAlpha = .55;
      [R.x + R.w / 3, R.x + R.w * 2 / 3].forEach(function(v){ r(v, R.y, 1, R.floor - R.y, '#b9c6c9'); });
      g.globalAlpha = 1;
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
    function building(){
      r(0, 0, W, H, '#e4ecea');
      var floors = Math.ceil(P.length / 2), by = TOPY + floors * FH - 4, bh = H - by, y, x;
      r(6, 16, W - 12, TOPY + floors * FH - 10, '#2e3138');
      r(0, TOPY - 20, W, 6, '#2e3138');
      r(0, by, W, bh, '#332f37');
      for (y = 0; y < bh; y += 8) { r(0, by + y, W, 1, '#201d24'); for (x = (y % 16 ? 0 : 14); x < W; x += 28) r(x, by + y, 1, 8, '#201d24'); }
      r(0, by, W, 3, '#7a2f25');
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
      roomShell(R); shine(R);
      if (o.mode === 'off') { curtain(R); band(o, t); glass(R); return; }
      var list = scriptOf(o), s = list[o.i % list.length] || { a: 'stand', t: 1 }, seated = s.a === 'sit' && o.x === c.seat, X = R.x + Math.round(o.x);
      if (o.id === 'ceo') attendance(R.x + 232, R.y + 14);
      if (o.id === 'head') lamps(R.x + 226, R.y + 22, o.count);
      if (o.id === 'ezadmin') { labels(R.x + 16, F, Math.min(14, o.count)); labels(R.x + 46, F, Math.min(14, Math.max(0, o.count - 14))); }
      if (o.id === 'ebut') { shelf(R.x + 238, F, 3); boxAt(R.x + 10, F - 16); boxAt(R.x + 10, F - 32); }
      if (c.desk) chair(R.x + c.seat, F);
      if (c.desk && !seated) desk(R.x + c.desk, F, true, t);
      if (seated) sitting(X, F, 1, PAL[o.id], { t: t + c.seat });
      else standing(X, F, s.a === 'stand' && s.dir ? s.dir : o.dir, PAL[o.id], { t: t + c.seat, walk: (s.a === 'walk' || s.a === 'sit') && !reduce, box: s.box, sheet: s.sheet, point: s.point });
      if (c.desk && seated) { desk(R.x + c.desk, F, true, t); seatedArm(X, F, PAL[o.id], { t: t + c.seat, type: s.type, sip: s.sip }); }
      if (o.mode === 'alert') { g.globalAlpha = .16; r(R.x, R.y, R.w, F - R.y, '#d8543f'); g.globalAlpha = 1; }
      band(o, t);
      glass(R);
    }
    function draw(){ building(); P.forEach(function(o){ drawRoom(o, T); }); }

    function layout(rooms){
      var floors = Math.ceil(rooms.length / 2);
      H = TOPY + floors * FH + 56;
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
        o.el.className = 'plate ' + m.mode;
        o.el.textContent = '';
        o.el.appendChild(document.createTextNode(m.name));
        var b = document.createElement('b'); b.textContent = m.say; o.el.appendChild(b);
      });
      draw();
    }

    var last = 0;
    function frame(n){
      var dt = Math.min(.1, (n - last) / 1000);
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
    return { update: update, peek: peek };
  }

  root.SECRETARY_OFFICE = { mount: mount, SPRITES: { HEADS: HEADS, FACE: FACE, FACE_BOB: FACE_BOB, BODY: BODY, SUIT: SUIT, LEGS: LEGS, SIT: SIT } };
})(window);
