/* ============================================================
   메이크창고 전담비서 — 헤드비서 실행기 (secretary.html?run=1 짝꿍, 브라우저·Node 공용, 2026-11-01)

   명령을 받아 정해진 작업만 한다. Firebase 와 탭은 deps 로 받는다.
     deps.store    claimRunner·getRunner·claimCommand·setCommand·getJobs·setJob·getControl·setSite
     deps.openSite 사이트 탭을 열어 도우미 ping 응답을 돌려줌. 안 되면 throw
     deps.relogin  로그인 화면에서 크롬이 채운 값으로 로그인 버튼을 한 번 누름. { tried, why }. 비밀번호는 다루지 않음
     deps.ezPreview({ from, to }) 곡물도감 검색 후 secretary_ez.preview 결과를 돌려줌
     deps.unseal(sealed)·deps.login(site, creds) 비서 화면에서 입력한 로그인 값을 풀어 한 번 쓰고 버림. 저장·기록 금지
     deps.ebutUpload(file) 맨소래담 파일을 이벗 연동몰에 등록. 파일은 이 컴퓨터 메모리에만 있고 Firebase 로 가지 않음
     deps.ezSearch(args)·deps.ezWrite(cmd, args) 합포 분할 화면(ez_split.html?remote=1)이 보낸 요청을 도우미로 전달
     deps.bizemRead(cmd)·deps.bizemGo(cmd, args) 비젬 화면 읽기와, 사람이 누른 수집·주문확정 한 번씩
     deps.ebutMatchPage() 이벗 주문서매칭 창을 이 탭에 엶. 매칭 저장은 deps.ebutGo('matchSave', item)
     deps.ebutOrderPage()·deps.ebutRead(cmd)·deps.ebutGo(cmd) 이벗 주문서등록 화면 열기·읽기·사람이 누른 주문가져오기 한 번
     deps.bizemFile(seen, key) 비젬 양식을 받아 나눠 실행 PC 메모리에 둠. 사람이 요청하면 그 화면의 1회용 키로 잠가서만 내려보냄
   저장은 사람이 누른 요청으로만 한다. 그 밖의 작업은 읽기 전용.
============================================================ */
(function(root){
  'use strict';
  var C = typeof module !== 'undefined' && module.exports ? require('./secretary_core.js') : root.SECRETARY_CORE;

  function createRunner(deps){
    var store = deps.store;
    var chain = Promise.resolve();
    /* 이지어드민 탭을 새로 열 때마다 gen 이 올라감. 채운 내용은 같은 탭에만 있으므로 gen 이 다르면 저장하지 않음 */
    var gen = 0, searchedGen = -1, filledGen = -1, holdUntil = 0;
    /* 출력 중에는 이지어드민 탭을 절대 새로 열지 않음. printSeen = 화면의 마지막 요청 */
    var printing = false, printSeen = 0, printJob = '';
    var prepared = false;
    function holding(){ return printing || deps.now() < holdUntil; }
    /* 헤드비서 탭 새로고침을 미룰 때: 출력 중이거나, 채운 내용·출력 준비가 탭에 남아 있을 때만. 불러오기만 한 상태로는 새 판 반영을 막지 않음 (대표님 2026-11-02) */
    function mustStay(){ return printing || (holding() && (filledGen === gen || prepared)); }

    async function claim(){
      var ok = await store.claimRunner(deps.runnerId, deps.info || {});
      if (!ok) return false;
      /* 앞 탭이 작업 중에 꺼졌으면 진행 중으로 남아 있음. 시동을 막지 않게 정리 */
      var jobs = (await store.getJobs()) || {};
      for (var k of Object.keys(jobs)) {
        if (!jobs[k] || (jobs[k].state !== 'running' && jobs[k].state !== 'printing')) continue;
        await store.setJob(k, { state: 'interrupted', endedAt: deps.now(), notes: '헤드비서 탭이 다시 켜져 중단 처리' });
        if (jobs[k].cmd) await store.setCommand(jobs[k].cmd, { status: 'interrupted', doneAt: deps.now() });
      }
      return true;
    }

    async function readSite(site){
      if (site.id === 'ezadmin') gen++;
      try {
        var reply = await deps.openSite(site), r = C.siteState(site.id, reply);
        r.ver = (reply && reply.ver) || '';
        return r;
      } catch (e) {
        return { state: 'error', msg: String((e && e.message) || e), ver: '' };
      }
    }
    /* 로그인이 풀렸으면 재로그인을 한 번만 시도. 실패하면 로그인이 돌아올 때까지 다시 시도하지 않음(계정 잠김 방지) */
    var triedLogin = {}, whyLogin = {};
    async function checkOne(site){
      var r = await readSite(site);
      if (r.state === 'ok') { triedLogin[site.id] = false; whyLogin[site.id] = ''; }
      if (r.state === 'login' && deps.relogin && !triedLogin[site.id]) {
        triedLogin[site.id] = true;
        var tried = null;
        try { tried = await deps.relogin(site); } catch (e) { tried = { tried: false, why: String((e && e.message) || e) }; }
        whyLogin[site.id] = (tried && tried.why) || (tried && tried.tried ? '자동 재로그인 실패' : '');
        if (tried && tried.tried) {
          r = await readSite(site);
          if (r.state === 'ok') { triedLogin[site.id] = false; whyLogin[site.id] = ''; r.msg = '로그인 유지 (자동 재로그인)'; }
        }
      }
      if (r.state === 'login' && whyLogin[site.id]) r.msg = '로그인이 필요합니다 (' + whyLogin[site.id] + ')';
      /* 비젬: 건수만 읽어 둠. 못 읽어도 다른 비서를 막지 않음 */
      if (site.id === 'bizem' && r.state === 'ok' && deps.bizemCounts) {
        try { r.counts = await deps.bizemCounts(); r.countsAt = deps.now(); } catch (e) { r.msg = '건수를 읽지 못했습니다'; }
      }
      r.checkedAt = deps.now();
      await store.setSite(site.id, r);
      return r;
    }
    async function checkSites(){
      var results = [];
      for (var site of C.SITES) {
        var r = await checkOne(site);
        results.push({ id: site.id, name: site.name, state: r.state, msg: r.msg });
      }
      return results;
    }
    /* 로그인 유지: 사이트를 주기적으로 열어 세션을 살리고 끊김을 먼저 찾음. 작업 중이거나 멈춤이면 건너뜀 */
    function keepAlive(){
      var run = chain.then(async function(){
        var control = await store.getControl();
        if ((control && control.pause) || holding()) return false;
        var jobs = (await store.getJobs()) || {};
        if (Object.keys(jobs).some(function(k){ return jobs[k] && jobs[k].state === 'running'; })) return false;
        await checkSites();
        return true;
      });
      chain = run.catch(function(){});
      return run;
    }

    async function runStart(id, cmd){
      var now = deps.now();
      var jobs = (await store.getJobs()) || {};
      var running = Object.keys(jobs).map(function(k){ return jobs[k]; }).find(function(j){ return j && j.state === 'running'; });
      var block = C.startBlock({ runner: await store.getRunner(), control: await store.getControl(), job: running, now: now });
      if (block) { await store.setCommand(id, { status: 'refused', why: block, doneAt: now }); return; }

      var date = C.kstDate(now);
      var key = C.jobKey('ez_daily', date, C.nextRound(jobs, 'ez_daily', date));
      var range = C.dateRange(cmd.from, now);
      await store.setJob(key, { state: 'running', recipe: 'ez_daily', trigger: 'start', by: cmd.by || '', at: now, cmd: id, from: range.from, to: range.to });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var results = await checkSites();
        var bad = results.filter(function(r){ return r.state !== 'ok'; });
        var sites = {};
        results.forEach(function(r){ sites[r.id] = { state: r.state, msg: r.msg }; });
        var notes = bad.map(function(r){ return r.name + ': ' + r.msg; });
        var ez = results.find(function(r){ return r.id === 'ezadmin'; });
        var stop = !ez || ez.state !== 'ok';   /* 이벗 문제는 이지어드민 비서를 막지 않고 알리기만 함 */
        var patch = { endedAt: 0, sites: sites };
        if (!stop) {
          await store.setCommand(id, { status: 'reading', jobKey: key });
          try {
            patch.preview = await deps.ezPreview(range);
            if (patch.preview.blockers.length) { stop = true; notes = notes.concat(patch.preview.blockers); }
            var prevKey = Object.keys(jobs).filter(function(k){ return k !== key && jobs[k] && (jobs[k].recipe || 'ez_daily') === 'ez_daily' && jobs[k].preview; }).sort(function(a, b){ return (jobs[b].at || 0) - (jobs[a].at || 0); })[0];
            var carried = prevKey ? C.ezAckCarry(jobs[prevKey], patch.preview) : null;
            if (carried) patch.ack = carried;
          } catch (e) {
            stop = true;
            notes.push('주문 읽기 실패: ' + String((e && e.message) || e));
          }
        }
        patch.state = stop ? 'stopped' : 'done';
        patch.notes = notes.join(' / ');
        patch.endedAt = deps.now();
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      } catch (e) {
        /* 진행 중으로 남으면 다음 시동이 계속 막힌다 */
        await store.setJob(key, { state: 'interrupted', endedAt: deps.now(), notes: '점검 중 오류: ' + String((e && e.message) || e) }).catch(function(){});
        throw e;
      }
    }

    /* 합포 분할 화면의 요청 처리. 화면은 어느 컴퓨터에 있어도 되고, 이지어드민 조작은 여기(상시 컴퓨터)에서 함.
       수령자 이름은 Firebase 에 올리지 않음 */
    async function relayRun(call){
      var cmd = call.cmd, args = JSON.parse(call.args || '{}'), site = C.SITES.find(function(s){ return s.id === 'ezadmin'; });
      var GONE = '이지어드민 화면이 새로 열려 채운 내용이 사라졌습니다. 불러오기부터 다시 해 주세요';
      if (C.RELAY_CMDS.indexOf(cmd) < 0) throw new Error('허용되지 않은 요청: ' + cmd);
      if (cmd === 'printStatus' || cmd === 'printEnd' || cmd === 'printClose') return relayPrintAfter(cmd, args);
      var control = await store.getControl();
      if (control && control.pause) throw new Error('전체 멈춤 상태입니다');
      var jobs = (await store.getJobs()) || {};
      if (Object.keys(jobs).some(function(k){ return jobs[k] && jobs[k].state === 'running'; })) throw new Error('진행 중인 작업이 있습니다. 끝난 뒤 다시 해 주세요');
      if (printing && cmd !== 'printPrep' && cmd !== 'printGo') throw new Error('송장출력 중입니다. 끝난 뒤 다시 해 주세요');
      if (cmd === 'printPrep') {
        /* 준비 내용은 탭 안에 있어 연결돼 있으면 새로 열지 않음. 공급처 사이에도 탭을 유지 */
        if (!(await deps.ezPing())) {
          var rs = await checkOne(site);
          if (rs.state !== 'ok') throw new Error('이지어드민: ' + rs.msg);
        }
        var prep = await deps.ezWrite('printPrep', args);
        prepared = true;
        holdUntil = deps.now() + C.RELAY_HOLD;
        return prep;
      }
      if (cmd === 'printGo') {
        var started = await deps.ezWrite('printGo', args);
        printing = true; printSeen = deps.now();
        if (!printJob) {
          var d = C.kstDate(printSeen);
          printJob = C.jobKey('ez_print', d, C.nextRound(jobs, 'ez_print', d));
          await store.setJob(printJob, { state: 'printing', recipe: 'ez_print', trigger: 'relay', by: call.by || '', at: printSeen });
        }
        started.jobKey = printJob;
        return started;
      }
      if (cmd === 'search') {
        var r = await checkOne(site);
        if (r.state !== 'ok') throw new Error('이지어드민: ' + r.msg);
        var found = await deps.ezSearch(args);
        searchedGen = gen; filledGen = -1; holdUntil = deps.now() + C.RELAY_HOLD;
        return { total: found.total, rows: (found.rows || []).map(function(x){ var y = Object.assign({}, x); delete y.recv; return y; }) };
      }
      if (cmd === 'fill') {
        if (searchedGen !== gen) throw new Error(GONE);
        var f = await deps.ezWrite('fill', args);
        if (f.done.length) filledGen = gen;
        holdUntil = deps.now() + C.RELAY_HOLD;
        return f;
      }
      if (filledGen !== gen) throw new Error(GONE);
      if (cmd === 'reset') {
        var back = await deps.ezWrite('reset', args);
        filledGen = -1;
        holdUntil = deps.now() + C.RELAY_HOLD;
        return back;
      }
      /* commit: 시도는 한 번뿐. 실패해도 채운 표시를 지워 다시 저장되지 않게 함 */
      filledGen = -1; holdUntil = 0;
      var now = deps.now(), date = C.kstDate(now), key = C.jobKey('ez_split', date, C.nextRound(jobs, 'ez_split', date));
      await store.setJob(key, { state: 'running', recipe: 'ez_split', trigger: 'relay', by: call.by || '', at: now, step: '일괄합포제외 저장 중' });
      try {
        /* fail_list 는 이지어드민이 나누지 않은 묶음 전부(애초에 채우지 않은 주문 포함)라 그 자체로 오류가 아님. 실제 반영은 화면이 다시 검색해 대조함 */
        var c = await deps.ezWrite('commit', args), bad = c.error != null && String(c.error) !== '0';
        await store.setJob(key, { state: bad ? 'stopped' : 'done', step: '', endedAt: deps.now(), notes: bad ? '이지어드민 응답 ' + c.error : '', result: { error: bad ? String(c.error) : '', undivided: (c.fail_list || []).length, lock: c.lock == null ? -1 : c.lock } });
        c.jobKey = key;
        return c;
      } catch (e) {
        await store.setJob(key, { state: 'stopped', step: '', endedAt: deps.now(), notes: '일괄합포제외 실패: ' + String((e && e.message) || e) + '. 저장됐을 수 있으니 시작 버튼으로 확인해 주세요' });
        throw e;
      }
    }
    /* 출력 진행 확인과 마무리는 멈춤·다른 작업과 상관없이 받음 */
    async function relayPrintAfter(cmd, args){
      printSeen = deps.now();
      var r = await deps.ezWrite(cmd, args);
      if (cmd === 'printEnd') { printing = false; holdUntil = deps.now() + C.RELAY_HOLD; }
      if (cmd === 'printClose' && !printing) { holdUntil = 0; printJob = ''; prepared = false; }
      return r;
    }
    /* 화면이 닫혀 요청이 끊겼을 때: 지금 공급처가 끝나면 마무리해서 다음 작업을 막지 않음. 남은 공급처는 출력하지 않음 */
    function printWatch(){
      var run = chain.then(async function(){
        if (!printing || deps.now() - printSeen < C.PRINT_IDLE) return false;
        var s;
        try { s = await deps.ezWrite('printStatus', {}); } catch (e) { s = null; }
        if (s && s.busy) return false;
        if (s) {
          await deps.ezWrite('printEnd', {}).catch(function(){});
          await deps.ezWrite('printClose', {}).catch(function(){});
        }
        printing = false; holdUntil = 0; prepared = false;
        if (printJob) await store.setJob(printJob, { state: 'stopped', endedAt: deps.now(), notes: '출력 화면이 닫혀 헤드비서가 마무리함. 남은 공급처는 출력 안 함. 이지어드민에서 확인 필요' });
        printJob = '';
        return true;
      });
      chain = run.catch(function(){});
      return run;
    }
    /* 비서 화면의 로그인 입력. 받자마자 지우고, 값은 이 함수 밖으로 나가지 않음. 실패해도 다시 시도하지 않음 */
    async function loginRun(req){
      var site = C.SITES.find(function(s){ return s.id === req.site; });
      if (!site) return { ok: false, why: '모르는 사이트' };
      if (!req.at || deps.now() - req.at > C.LOGIN_TTL) return { ok: false, why: '시간이 지났습니다. 다시 입력해 주세요' };
      if (mustStay()) return { ok: false, why: '출력이나 저장이 진행 중입니다. 끝난 뒤 다시 해 주세요' };
      var jobs = (await store.getJobs()) || {};
      if (Object.keys(jobs).some(function(k){ return jobs[k] && jobs[k].state === 'running'; })) return { ok: false, why: '진행 중인 작업이 있습니다. 끝난 뒤 다시 해 주세요' };
      var creds, tried;
      try { creds = await deps.unseal(req.sealed); }
      catch (e) { return { ok: false, why: '상시 컴퓨터가 새로 켜졌습니다. 다시 입력해 주세요' }; }
      try { tried = await deps.login(site, creds); }
      catch (e) { tried = { tried: false, why: '로그인 화면을 열지 못했습니다' }; }
      creds = null;
      var r = await readSite(site);
      r.checkedAt = deps.now();
      if (r.state === 'ok') { triedLogin[site.id] = false; whyLogin[site.id] = ''; }
      else {
        triedLogin[site.id] = true;
        whyLogin[site.id] = tried && !tried.tried ? tried.why : '입력한 값으로 로그인 실패';
        if (r.state === 'login') r.msg = '로그인이 필요합니다 (' + whyLogin[site.id] + ')';
      }
      await store.setSite(site.id, r);
      if (r.state === 'ok') return { ok: true, why: '' };
      return { ok: false, why: tried && !tried.tried ? tried.why : '로그인되지 않았습니다. 아이디와 비밀번호를 확인해 주세요. 맞다면 보안문자가 떴을 수 있으니 상시 컴퓨터에서 직접 로그인해 주세요' };
    }
    function handleLogin(id, req){
      var run = chain.then(async function(){
        await store.clearLoginReq(id);
        var out;
        try { out = await loginRun(req); } catch (e) { out = { ok: false, why: '로그인 처리 중 오류가 났습니다' }; }
        await store.setLoginResult(id, { ok: out.ok, why: out.why, at: deps.now() });
      });
      chain = run.catch(function(){});
      return run;
    }
    /* 사람이 확인창에서 누른 등록 한 번. 다시 시도하지 않음. 기록에는 건수만 남김 */
    function uploadMenso(file){
      var run = chain.then(async function(){
        if (mustStay()) return { ok: false, why: '출력이나 저장이 진행 중입니다. 끝난 뒤 다시 해 주세요' };
        var jobs = (await store.getJobs()) || {};
        if (Object.keys(jobs).some(function(k){ return jobs[k] && jobs[k].state === 'running'; })) return { ok: false, why: '진행 중인 작업이 있습니다. 끝난 뒤 다시 해 주세요' };
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'ebut'; }));
        if (r.state !== 'ok') return { ok: false, why: '이벗: ' + r.msg };
        var res;
        try { res = await deps.ebutUpload(file); }
        catch (e) { return { ok: false, why: '등록 중 끊겼습니다. 등록됐을 수 있으니 이벗에서 먼저 확인해 주세요 (' + String((e && e.message) || e) + ')' }; }
        await store.setUpload({ day: C.kstDate(deps.now()), lines: file.lines, orders: file.orders, at: deps.now(), by: file.by || '', status: res.status });
        return { ok: true, status: res.status, alerts: res.alerts, text: res.text };
      });
      chain = run.catch(function(){});
      return run;
    }
    function handleCall(id, call){
      var run = chain.then(async function(){
        if (!(await store.claimCall(id))) return;
        var out;
        try {
          if (!call.at || deps.now() - call.at > C.RELAY_TTL) throw new Error('요청이 만료됐습니다. 다시 눌러 주세요');
          out = { ok: true, data: await relayRun(call) };
        } catch (e) { out = { ok: false, err: String((e && e.message) || e) }; }
        await store.setCall(id, { out: JSON.stringify(out) });
      });
      chain = run.catch(function(){});
      return run;
    }

    /* 비젬 주문수집 전 확인: 체크된 쇼핑몰과 기간을 읽어 명령 결과로 돌려줌. 비젬에 쓰지 않음 */
    async function bizemBlock(id){
      var now = deps.now(), jobs = (await store.getJobs()) || {};
      var running = Object.keys(jobs).map(function(k){ return jobs[k]; }).find(function(j){ return j && j.state === 'running'; });
      var block = C.startBlock({ runner: await store.getRunner(), control: await store.getControl(), job: running, now: now });
      if (block) await store.setCommand(id, { status: 'refused', why: block, doneAt: now });
      return block ? null : jobs;
    }
    /* 송장업로드 준비 조사: 비젬 송장 관련 화면의 버튼·표 제목만 읽어 명령 결과에 남김 (고객 정보 없음) */
    async function runBizemSurvey(id){
      if (!(await bizemBlock(id))) return;
      await store.setCommand(id, { status: 'reading' });
      try {
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'bizem'; }));
        if (r.state !== 'ok') { await store.setCommand(id, { status: 'refused', why: '비젬: ' + r.msg, doneAt: deps.now() }); return; }
        await store.setCommand(id, { status: 'done', survey: await (deps.bizemSurvey || function(){ return deps.bizemRead('survey'); })(), doneAt: deps.now() });
      } catch (e) {
        await store.setCommand(id, { status: 'refused', why: String((e && e.message) || e), doneAt: deps.now() });
      }
    }
    async function runBizemCheck(id){
      if (!(await bizemBlock(id))) return;
      await store.setCommand(id, { status: 'reading' });
      try {
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'bizem'; }));
        if (r.state !== 'ok') { await store.setCommand(id, { status: 'refused', why: '비젬: ' + r.msg, doneAt: deps.now() }); return; }
        await store.setCommand(id, { status: 'done', check: await deps.bizemRead('collectCheck'), doneAt: deps.now() });
      } catch (e) {
        await store.setCommand(id, { status: 'refused', why: String((e && e.message) || e), doneAt: deps.now() });
      }
    }
    function bizemSleep(ms){ return deps.sleep ? deps.sleep(ms) : new Promise(function(ok){ setTimeout(ok, ms); }); }
    /* 실행 후 대조: 체크한 쇼핑몰마다 수집 시각이 바뀌고 상태가 정상이어야 함 */
    function collectNotNew(before, after, names){
      function find(list, n){ return (list || []).find(function(m){ return m.name === n; }); }
      return names.filter(function(n){ var a = find(after, n), b = find(before, n); return !a || a.status !== '정상종료' || !a.last || (!!b && a.last === b.last); });
    }
    /* 주문확정(전체) 한 번. 화면 기본 조건 그대로이고, 어떤 경우에도 다시 누르지 않음. seen = 사람이 화면에서 본 대기 건수 */
    async function bizemConfirm(key, seen){
      var site = C.SITES.find(function(s){ return s.id === 'bizem'; }), r = await checkOne(site), chk, go;
      if (r.state !== 'ok') return { note: '비젬: ' + r.msg + '. 주문확정은 하지 않았습니다' };
      var before = r.counts || { unconfirmed: -1, printWait: -1 };
      if (seen !== undefined && before.unconfirmed !== seen) return { note: '주문확정 대기가 ' + seen + '건에서 ' + before.unconfirmed + '건으로 바뀌어 확정하지 않았습니다. 다시 확인해 주세요' };
      try { chk = await deps.bizemRead('confirmCheck'); }
      catch (e) { return { note: '주문확정 건수를 읽지 못해 확정하지 않았습니다: ' + String((e && e.message) || e) }; }
      if (chk.status !== 'A10' || chk.hold !== '10') return { note: '주문서확정 화면 조건이 평소와 달라 확정하지 않았습니다' };
      if (!chk.orders) return { note: before.unconfirmed > 0 ? '화면 기간 안에 확정할 주문이 없는데 대기 ' + before.unconfirmed + '건이 남아 있습니다. 비젬에서 확인해 주세요' : '', confirm: { orders: 0, after: Math.max(before.unconfirmed, 0), printWait: Math.max(before.printWait, 0) } };
      await store.setJob(key, { step: '주문확정 ' + chk.orders + '건 처리 중' });
      try { go = await deps.bizemGo('confirmGo', { orders: chk.orders }); }
      catch (e) { return { note: '응답이 끊겼습니다. 확정됐을 수 있으니 비젬에서 먼저 확인해 주세요 (' + String((e && e.message) || e) + ')' }; }
      if (!go.started) return { note: '주문확정이 시작되지 않았습니다: ' + go.why };
      var s = null, now = null, miss = 0, tries = Math.ceil(C.COLLECT_MAX / C.COLLECT_POLL), deadline = deps.now() + C.COLLECT_MAX, finished = false;
      while (tries-- > 0 && deps.now() <= deadline) {
        await bizemSleep(C.COLLECT_POLL);
        try { s = await deps.bizemRead('confirmStatus'); now = await deps.bizemCounts(); miss = 0; }
        catch (e) { if (++miss >= 6) break; continue; }
        if (s.ask) return { note: '비젬이 주문확정 중 확인을 묻고 있습니다. 실행 PC 의 비젬 탭에서 직접 정해 주세요' };
        if (s.error) return { note: '비젬 오류: ' + s.error + '. 비젬에서 먼저 확인해 주세요' };
        if (s.done || now.unconfirmed === 0) { finished = true; break; }
        if (s.lost) return { note: '진행 화면이 끊겼습니다. 확정됐을 수 있으니 비젬에서 먼저 확인해 주세요' };
      }
      if (!finished) return { note: '주문확정 끝 소식을 받지 못했습니다. 비젬에서 먼저 확인해 주세요' };
      await store.setSite('bizem', Object.assign({}, r, { counts: now, countsAt: deps.now() }));
      var confirm = { orders: chk.orders, after: now.unconfirmed, printWait: now.printWait };
      return { note: now.unconfirmed > 0 ? '주문확정 뒤 대기 ' + now.unconfirmed + '건이 남았습니다. 비젬에서 확인해 주세요' : '', confirm: confirm };
    }
    /* 이미 수집된 주문을 확정만 함 */
    async function runBizemConfirm(id, cmd){
      if (deps.now() - cmd.at > C.RELAY_TTL) { await store.setCommand(id, { status: 'expired', doneAt: deps.now() }); return; }
      var jobs = await bizemBlock(id);
      if (!jobs) return;
      var now = deps.now(), date = C.kstDate(now), key = C.jobKey('bizem_collect', date, C.nextRound(jobs, 'bizem_collect', date));
      await store.setJob(key, { state: 'running', recipe: 'bizem_collect', trigger: 'relay', by: cmd.by || '', at: now, cmd: id, step: '주문확정 확인 중', notes: '' });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var cf = await bizemConfirm(key, cmd.seen);
        await store.setJob(key, { state: cf.note ? 'stopped' : 'done', step: '', endedAt: deps.now(), notes: cf.note, result: { confirm: cf.confirm || null } });
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', step: '', endedAt: deps.now(), notes: '오류: ' + String((e && e.message) || e) + '. 비젬에서 먼저 확인해 주세요' }).catch(function(){});
        throw e;
      }
    }
    /* 사람이 쇼핑몰 목록을 보고 누른 수집 한 번. 쇼핑몰에 발주확인 처리되어 되돌릴 수 없음. 어떤 경우에도 다시 누르지 않음 */
    async function runBizemCollect(id, cmd){
      if (deps.now() - cmd.at > C.RELAY_TTL) { await store.setCommand(id, { status: 'expired', doneAt: deps.now() }); return; }
      var jobs = await bizemBlock(id);
      if (!jobs) return;
      var now = deps.now(), date = C.kstDate(now), key = C.jobKey('bizem_collect', date, C.nextRound(jobs, 'bizem_collect', date)), site = C.SITES.find(function(s){ return s.id === 'bizem'; });
      async function end(state, notes, result){
        var patch = { state: state, step: '', endedAt: deps.now(), notes: notes };
        if (result) patch.result = result;
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      }
      var names = cmd.malls || [];
      await store.setJob(key, { state: 'running', recipe: 'bizem_collect', trigger: 'relay', by: cmd.by || '', at: now, cmd: id, step: '비젬 확인 중', notes: '' });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var r = await checkOne(site), before = r.counts || null, chk;
        if (r.state !== 'ok') return end('stopped', '비젬: ' + r.msg);
        try { chk = await deps.bizemRead('collectCheck'); }
        catch (e) { return end('stopped', '쇼핑몰 목록을 읽지 못해 수집하지 않았습니다: ' + String((e && e.message) || e)); }
        if (chk.checked.join('|') !== names.join('|') || chk.from !== cmd.from || chk.to !== cmd.to || chk.opt !== cmd.opt) return end('stopped', '화면에서 본 쇼핑몰·기간과 달라 수집하지 않았습니다. 다시 눌러 확인해 주세요');
        await store.setJob(key, { step: '주문수집 중' });
        var go;
        try { go = await deps.bizemGo('collectGo', {}); }
        catch (e) { return end('stopped', '응답이 끊겼습니다. 수집됐을 수 있으니 비젬에서 먼저 확인해 주세요 (' + String((e && e.message) || e) + ')'); }
        if (!go.started) return end('stopped', '수집이 시작되지 않았습니다: ' + go.why);
        var s = null, miss = 0, tries = Math.ceil(C.COLLECT_MAX / C.COLLECT_POLL), deadline = deps.now() + C.COLLECT_MAX;
        while (tries-- > 0 && deps.now() <= deadline) {
          await bizemSleep(C.COLLECT_POLL);
          try { s = await deps.bizemRead('collectStatus'); miss = 0; }
          catch (e) { s = null; if (++miss >= 6) break; continue; }
          if (s.done || s.error || s.lost) break;
        }
        if (!s || s.lost) return end('stopped', '진행 화면이 끊겼습니다. 수집됐을 수 있으니 비젬에서 먼저 확인해 주세요');
        if (s.error) return end('stopped', '비젬 오류: ' + s.error + '. 비젬에서 먼저 확인해 주세요');
        if (!s.done) return end('stopped', '끝 소식을 받지 못했습니다. 비젬에서 먼저 확인해 주세요');
        var after = null;
        try {
          after = await deps.bizemCounts();
          await store.setSite('bizem', Object.assign({}, r, { counts: after, countsAt: deps.now() }));
        } catch (e) { after = null; }
        var notNew = collectNotNew(chk.malls, s.malls, names);
        var result = { counts: { before: before ? before.unconfirmed : -1, after: after ? after.unconfirmed : -1 }, notNew: notNew, alerts: go.alerts || [], malls: names.length };
        /* 수집이 정상일 때만 이어서 확정. 일부 쇼핑몰이 빠졌으면 사람이 먼저 봄 */
        if (notNew.length) return end('stopped', '수집 확인 필요: ' + notNew.join(', ') + '. 주문확정은 하지 않았습니다', result);
        if (!cmd.confirm) return end('done', '', result);
        var cf = await bizemConfirm(key);
        result.confirm = cf.confirm || null;
        await end(cf.note ? 'stopped' : 'done', cf.note, result);
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', step: '', endedAt: deps.now(), notes: '오류: ' + String((e && e.message) || e) + '. 비젬에서 먼저 확인해 주세요' }).catch(function(){});
        throw e;
      }
    }

    /* 양식 받기 전 확인: 대기 건수는 화면에 이미 있으므로 양식·이미 받은 건수만 읽어 돌려줌. 비젬에 쓰지 않음 */
    async function runBizemForm(id){
      if (!(await bizemBlock(id))) return;
      await store.setCommand(id, { status: 'reading' });
      try {
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'bizem'; }));
        if (r.state !== 'ok') { await store.setCommand(id, { status: 'refused', why: '비젬: ' + r.msg, doneAt: deps.now() }); return; }
        await store.setCommand(id, { status: 'done', form: await deps.bizemRead('formCheck'), printWait: r.counts ? r.counts.printWait : -1, doneAt: deps.now() });
      } catch (e) {
        await store.setCommand(id, { status: 'refused', why: String((e && e.message) || e), doneAt: deps.now() });
      }
    }
    /* 이벗 답은 고객 정보가 섞일 수 있어 건수 안내로 보이는 짧은 문구만 기록 */
    function safeAlerts(list){
      return (list || []).filter(function(a){ return String(a).length <= 60 && /건|등록|완료|실패|중복/.test(a) && !/\d{9,}|\d+-\d+-\d+/.test(a); });
    }
    /* 사람이 건수를 보고 누른 한 번: 비젬 양식 받기 → 나누기 → 맨소래담 이벗 등록. 어떤 단계도 다시 시도하지 않음.
       박스앤캔 파일과, 등록하지 못한 맨소래담 파일은 비서 화면에서 내려받을 수 있게 표시 */
    async function runBizemImport(id, cmd){
      if (deps.now() - cmd.at > C.RELAY_TTL) { await store.setCommand(id, { status: 'expired', doneAt: deps.now() }); return; }
      var jobs = await bizemBlock(id);
      if (!jobs) return;
      var now = deps.now(), date = C.kstDate(now), key = C.jobKey('bizem_import', date, C.nextRound(jobs, 'bizem_import', date));
      async function end(state, notes, result){
        var patch = { state: state, step: '', endedAt: deps.now(), notes: notes };
        if (result) patch.result = result;
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      }
      function keep(){ return true; }
      await store.setJob(key, { state: 'running', recipe: 'bizem_import', trigger: 'relay', by: cmd.by || '', at: now, cmd: id, step: '비젬 확인 중', notes: '' });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'bizem'; })), chk, file;
        if (r.state !== 'ok') return end('stopped', '비젬: ' + r.msg);
        if (!r.counts || r.counts.printWait !== cmd.seen) return end('stopped', '운송장인쇄 대기가 화면에서 본 건수와 달라 받지 않았습니다. 다시 눌러 확인해 주세요');
        try { chk = await deps.bizemRead('formCheck'); }
        catch (e) { return end('stopped', '양식 화면을 읽지 못해 받지 않았습니다: ' + String((e && e.message) || e)); }
        if (!chk.form) return end('stopped', '양식 0000_박스앤캔_코코나나양식 을 찾지 못해 받지 않았습니다');
        /* 화면 기본값이 빈 값(전체)이거나 B10 일 수 있음. 전에 받은 주문이 섞여 있어도 파일은 항상 만듦 — 중복은 이벗 등록 단계에서 걸러짐 (대표님 2026-11-04) */
        if (chk.status !== 'B10' && chk.status !== '') return end('stopped', '운송장인쇄 화면 조건이 평소와 달라 받지 않았습니다');
        if (chk.memo) return end('stopped', '비젬에 먼저 읽어야 할 쪽지가 있습니다. 비젬 탭에서 확인해 주세요');
        await store.setJob(key, { step: '비젬 양식 받는 중' });
        try { file = await deps.bizemFile(cmd.seen, key); }
        catch (e) { return end('stopped', '양식을 받지 못했습니다: ' + String((e && e.message) || e) + '. 비젬에 받은 기록이 남았을 수 있습니다'); }
        var result = { lines: file.lines, orders: file.orders, sites: file.sites, box: false, menso: false, held: true, dup: Number(chk.downloaded) || 0 };   /* held = 실행 PC 메모리에 두는 방식 */
        if (file.lines.boxncan) result.box = keep('boxncan');
        if (file.lines.menso + file.lines.boxncan < cmd.seen) { if (file.lines.menso) result.menso = keep('menso'); return end('stopped', '대기 ' + cmd.seen + '건인데 받은 줄이 ' + (file.lines.menso + file.lines.boxncan) + '줄이라 등록하지 않았습니다', result); }
        if (!file.lines.menso) return end('done', '', result);
        if (file.noAddress) { result.menso = keep('menso'); return end('stopped', '맨소래담 주소 없는 줄 ' + file.noAddress + '건이 있어 등록하지 않았습니다. 이벗은 그 줄 이후를 등록하지 않습니다', result); }
        await store.setJob(key, { step: '이벗 등록 중' });
        var e2 = await checkOne(C.SITES.find(function(s){ return s.id === 'ebut'; }));
        if (e2.state !== 'ok') { result.menso = keep('menso'); return end('stopped', '이벗: ' + e2.msg + '. 등록하지 않았습니다', result); }
        var res;
        try { res = await deps.ebutUpload(file.menso); }
        catch (e) { result.menso = keep('menso'); return end('stopped', '등록 중 끊겼습니다. 등록됐을 수 있으니 이벗에서 먼저 확인해 주세요 (' + String((e && e.message) || e) + ')', result); }
        await store.setUpload({ day: date, lines: file.lines.menso, orders: file.orders, at: deps.now(), by: cmd.by || '', status: res.status });
        result.upload = { status: res.status, alerts: safeAlerts(res.alerts) };
        if (res.status !== 200) { result.menso = keep('menso'); return end('stopped', '이벗 응답 ' + res.status + '. 이벗에서 먼저 확인해 주세요', result); }
        await end('done', '', result);
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', step: '', endedAt: deps.now(), notes: '오류: ' + String((e && e.message) || e) + '. 비젬과 이벗에서 먼저 확인해 주세요' }).catch(function(){});
        throw e;
      }
    }

    /* 비젬 송장업로드 (대표님 2026-11-06): 사람이 파일 건수를 보고 한 번 누르면 업로드·저장 → 발송검수 → 운송장전송까지.
       파일은 여러 개(예: 맨소래담·박스앤캔)를 한 번에 받아 운송장입력(대량)에 차례로 올리고(올리기는 계속 쌓임),
       다 올라가면 그 파일들의 주문 전부를 한꺼번에 발송검수 → 운송장전송 (대표님 2026-11-07).
       올린 파일의 쇼핑몰주문번호만 다룸. 100개씩 나눠 하되 같은 묶음을 다시 보내지 않음(상태가 안 바뀌면 멈춤).
       잠긴 파일은 받자마자 명령에서 지우고, 작업 기록에는 건수만 남김 */
    var INV_POLL = 5000, INV_WAIT = 5 * 60 * 1000;
    async function runBizemInvoice(id, cmd){
      if (deps.now() - cmd.at > C.RELAY_TTL) { await store.setCommand(id, { status: 'expired', sealed: null, doneAt: deps.now() }); return; }
      var jobs = await bizemBlock(id);
      if (!jobs) { await store.setCommand(id, { sealed: null }); return; }
      var now = deps.now(), date = C.kstDate(now), key = C.jobKey('bizem_invoice', date, C.nextRound(jobs, 'bizem_invoice', date));
      var I = (typeof window !== 'undefined' && window.BIZEM_INVOICE) || (typeof require === 'function' ? require('./bizem_invoice.js') : null);
      function arr(v){ return v == null ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.keys(v).sort(function(a, b){ return a - b; }).map(function(k){ return v[k]; }) : [v]; }
      var seals = arr(cmd.sealed), parts = arr(cmd.parts);
      var result = { files: seals.length, lines: cmd.lines || 0, orders: cmd.orders || 0 };
      async function end(state, notes){
        await store.setJob(key, { state: state, step: '', endedAt: deps.now(), notes: notes, result: result });
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      }
      function why(e){ return String((e && e.message) || e); }
      var files = [], all = [];
      async function list(screen, orders){ orders = orders || all; var r = await deps.bizemList({ screen: screen, orders: orders }); return I.tally(r.rows, orders); }
      await store.setJob(key, { state: 'running', recipe: 'bizem_invoice', trigger: 'relay', by: cmd.by || '', at: now, cmd: id, step: '파일 여는 중', notes: '' });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now, sealed: null, parts: null });
        if (!seals.length) return end('stopped', '받은 파일이 없습니다. 파일을 다시 골라 주세요');
        for (var fi = 0; fi < seals.length; fi++) {
          var f;
          try { f = await deps.openInvoice(seals[fi]); }
          catch (e) { return end('stopped', '파일을 열지 못했습니다 (상시 컴퓨터가 새로 켜졌을 수 있음). 파일을 다시 골라 주세요'); }
          if (seals.length > 1) f.name = String(f.name).replace(/(\.xlsx)?$/, '_' + (fi + 1) + '$1');
          files.push(f);
        }
        var seen = {}, dupAcross = 0, lines = 0;
        files.forEach(function(f){ lines += f.lines; f.orders.forEach(function(o){ if (seen[o]) dupAcross++; else { seen[o] = true; all.push(o); } }); });
        var partsOk = !parts.length || (parts.length === files.length && parts.every(function(p, i){ return p && p.lines === files[i].lines && p.orders === files[i].orders.length; }));
        if (!partsOk || lines !== cmd.lines || all.length !== cmd.orders) return end('stopped', '받은 파일 건수가 화면에서 본 건수와 달라 올리지 않았습니다');
        if (dupAcross) return end('stopped', '여러 파일에 같은 주문이 ' + dupAcross + '건 있어 올리지 않았습니다. 파일을 확인해 주세요');
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'bizem'; }));
        if (r.state !== 'ok') return end('stopped', '비젬: ' + r.msg);

        /* 0. 올리기 전: 이미 전송된 주문이 섞였으면 하나도 올리지 않음 */
        await store.setJob(key, { step: '비젬 주문 확인 중' });
        var t = await list('send');
        result.before = { sent: t.E10, failed: t.E11 };
        if (t.E10) return end('stopped', '이미 운송장이 전송된 주문 ' + t.E10 + '건이 파일에 있어 올리지 않았습니다. 비젬에서 확인해 주세요');

        /* 1. 업로드·저장: 파일마다 차례로 올리고, 그 파일 주문에 운송장번호가 다 들어간 걸 본 뒤 다음 파일 */
        result.uploaded = 0;
        for (var ui = 0; ui < files.length; ui++) {
          var file = files[ui], tag = files.length > 1 ? ' (' + (ui + 1) + '/' + files.length + ')' : '';
          await store.setJob(key, { step: '비젬에 송장 올리는 중' + tag });
          var up;
          try { up = await deps.bizemGo('invoiceUpload', { buffer: file.buffer, name: file.name }); }
          catch (e) { return end('stopped', (ui + 1) + '번째 파일을 올리는 중 끊겼습니다. 저장됐을 수 있으니 비젬에서 먼저 확인해 주세요 (' + why(e) + ')'); }
          if (!up.started) return end('stopped', (ui + 1) + '번째 파일을 올리지 못했습니다: ' + up.why);
          var t0 = deps.now(), last = -1, same = 0, tf;
          for (;;) {
            await bizemSleep(INV_POLL);
            tf = await list('check', file.orders);
            var done = tf.C10 + tf.D10 + tf.E10 + tf.E11;
            if (done >= file.orders.length) break;
            same = done === last ? same + 1 : 0; last = done;
            if (deps.now() - t0 > INV_WAIT || (done > 0 && same >= 12)) break;
          }
          var got = tf.C10 + tf.D10 + tf.E10 + tf.E11;
          result.uploaded += got;
          await store.setJob(key, { result: result });
          if (got < file.orders.length) return end('stopped', (ui + 1) + '번째 파일: 올린 뒤 운송장번호가 들어간 주문이 ' + got + ' / ' + file.orders.length + '건입니다. 비젬 업로드 결과 창에서 확인해 주세요');
        }
        var orderCount = all.length;

        /* 2. 발송검수: 운송장번호입력됨(C10)만 100개씩 */
        await store.setJob(key, { step: '발송검수 중' });
        result.checked = 0;
        for (var round = 0; round < orderCount / I.BATCH + 3; round++) {
          t = await list('check');
          if (!t.bzm.C10.length) break;
          var b1 = t.bzm.C10.slice(0, I.BATCH), c;
          try { c = await deps.bizemGo('invoiceCheckup', { bzm: b1 }); }
          catch (e) { return end('stopped', '발송검수 중 끊겼습니다. 비젬 발송검수 화면에서 확인해 주세요 (' + why(e) + ')'); }
          if (!c.ok) return end('stopped', c.why);
          result.checked += b1.length;
          await store.setJob(key, { step: '발송검수 중 · ' + result.checked + '건', result: result });
          var after = await list('check');
          if (b1.some(function(b){ return after.bzm.C10.indexOf(b) >= 0; })) return end('stopped', '발송검수를 보냈는데 상태가 바뀌지 않은 주문이 있습니다. 다시 보내지 않았습니다');
        }
        t = await list('check');
        if (t.C10) return end('stopped', '발송검수가 안 된 주문 ' + t.C10 + '건이 남았습니다');

        /* 3. 운송장전송: 검수됨(D10)만 100개씩. 전송 창이 끝나면 목록 상태로 다시 확인 */
        await store.setJob(key, { step: '운송장전송 중' });
        result.sent = 0;
        for (var round2 = 0; round2 < orderCount / I.BATCH + 3; round2++) {
          t = await list('send');
          if (!t.bzm.D10.length) break;
          var b2 = t.bzm.D10.slice(0, I.BATCH), s;
          try { s = await deps.bizemGo('invoiceSend', { bzm: b2 }); }
          catch (e) { return end('stopped', '전송 중 끊겼습니다. 비젬 쇼핑몰운송장전송 화면에서 확인해 주세요 (' + why(e) + ')'); }
          if (!s.started) return end('stopped', s.why);
          var t1 = deps.now(), left = b2.length;
          for (;;) {
            await bizemSleep(INV_POLL);
            var st = await deps.bizemRead('invoiceSendStatus').catch(function(){ return {}; });
            t = await list('send');
            left = b2.filter(function(b){ return t.bzm.D10.indexOf(b) >= 0; }).length;
            if (!left || deps.now() - t1 > INV_WAIT || (st.lost && left === b2.length && deps.now() - t1 > 60000)) break;
          }
          result.sent += b2.length - left;
          await store.setJob(key, { step: '운송장전송 중 · ' + result.sent + '건', result: result });
          if (left) return end('stopped', '전송 창을 띄웠는데 아직 검수됨으로 남은 주문 ' + left + '건이 있습니다. 다시 보내지 않았습니다. 비젬에서 확인해 주세요');
        }
        t = await list('send');
        result.done = t.E10; result.failed = t.E11;
        if (t.E11) return end('stopped', '운송장전송 실패 ' + t.E11 + '건이 있습니다. 비젬 쇼핑몰운송장전송 화면에서 확인해 주세요');
        if (t.E10 < orderCount) return end('stopped', '전송된 주문이 ' + t.E10 + ' / ' + orderCount + '건입니다. 비젬에서 확인해 주세요');
        await end('done', '');
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', step: '', endedAt: deps.now(), result: result, notes: '오류: ' + why(e) + '. 비젬에서 먼저 확인해 주세요' }).catch(function(){});
        await store.setCommand(id, { status: 'done', jobKey: key, sealed: null, doneAt: deps.now() }).catch(function(){});
        throw e;
      }
    }

    /* 이벗 주문가져오기 전 확인: 맨소레담공식스마트스토어 신규·배송대기 건수만 읽음 */
    async function runEbutCheck(id){
      if (!(await bizemBlock(id))) return;
      await store.setCommand(id, { status: 'reading' });
      try {
        var r = C.siteState('ebut', await deps.ebutOrderPage());
        if (r.state !== 'ok') { await store.setCommand(id, { status: 'refused', why: '이벗: ' + r.msg, doneAt: deps.now() }); return; }
        await store.setCommand(id, { status: 'done', store: await deps.ebutRead('storeCheck'), doneAt: deps.now() });
      } catch (e) {
        await store.setCommand(id, { status: 'refused', why: String((e && e.message) || e), doneAt: deps.now() });
      }
    }
    /* 사람이 신규 건수를 보고 누른 주문가져오기 한 번. 끝나기 전에 다시 가져오면 중복 등록되므로 어떤 경우에도 다시 누르지 않음 */
    async function runEbutCollect(id, cmd){
      if (deps.now() - cmd.at > C.RELAY_TTL) { await store.setCommand(id, { status: 'expired', doneAt: deps.now() }); return; }
      var jobs = await bizemBlock(id);
      if (!jobs) return;
      var now = deps.now(), date = C.kstDate(now), key = C.jobKey('ebut_collect', date, C.nextRound(jobs, 'ebut_collect', date));
      async function end(state, notes, result){
        var patch = { state: state, step: '', endedAt: deps.now(), notes: notes };
        if (result) patch.result = result;
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      }
      await store.setJob(key, { state: 'running', recipe: 'ebut_collect', trigger: 'relay', by: cmd.by || '', at: now, cmd: id, step: '이벗 확인 중', notes: '' });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var r = C.siteState('ebut', await deps.ebutOrderPage()), chk, go;
        if (r.state !== 'ok') return end('stopped', '이벗: ' + r.msg);
        try { chk = await deps.ebutRead('storeCheck'); }
        catch (e) { return end('stopped', '이벗 주문서등록 화면을 읽지 못해 가져오지 않았습니다: ' + String((e && e.message) || e)); }
        if (!chk.page) return end('stopped', '이벗 주문서등록 화면에서 맨소레담공식스마트스토어 줄을 찾지 못했습니다');
        if (chk.busy) return end('stopped', '이벗이 이미 주문을 가져오는 중입니다. 끝난 뒤 확인해 주세요');
        if (chk.newCnt !== cmd.seen) return end('stopped', '신규 주문이 ' + cmd.seen + '건에서 ' + chk.newCnt + '건으로 바뀌어 가져오지 않았습니다. 다시 눌러 확인해 주세요');
        await store.setJob(key, { step: '맨소래담 주문 가져오는 중' });
        try { go = await deps.ebutGo('storeGo'); }
        catch (e) { return end('stopped', '응답이 끊겼습니다. 가져왔을 수 있으니 다시 누르지 말고 이벗에서 먼저 확인해 주세요 (' + String((e && e.message) || e) + ')'); }
        if (!go.started) return end('stopped', '주문가져오기가 시작되지 않았습니다: ' + go.why);
        var s = null, miss = 0, tries = Math.ceil(C.COLLECT_MAX / C.COLLECT_POLL), deadline = deps.now() + C.COLLECT_MAX;
        while (tries-- > 0 && deps.now() <= deadline) {
          await bizemSleep(C.COLLECT_POLL);
          try { s = await deps.ebutRead('storeStatus'); miss = 0; }
          catch (e) { s = null; if (++miss >= 6) break; continue; }
          if (s.done || s.lost) break;
        }
        if (!s || s.lost) return end('stopped', '이벗 화면이 끊겼습니다. 가져왔을 수 있으니 다시 누르지 말고 이벗에서 먼저 확인해 주세요');
        if (!s.done) return end('stopped', '끝 소식을 받지 못했습니다. 다시 누르지 말고 이벗에서 먼저 확인해 주세요');
        await end('done', '', { before: { newCnt: chk.newCnt, waitCnt: chk.waitCnt }, after: s.newCnt, lines: s.lines || [] });
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', step: '', endedAt: deps.now(), notes: '오류: ' + String((e && e.message) || e) + '. 이벗에서 먼저 확인해 주세요' }).catch(function(){});
        throw e;
      }
    }

    /* 맨소래담: 이벗 로그인 점검 → 주문서목록 읽기 → 행사표로 사은품 대상 계산. 이벗에 쓰지 않음 */
    async function runMenso(id, cmd){
      var now = deps.now();
      var jobs = (await store.getJobs()) || {};
      var running = Object.keys(jobs).map(function(k){ return jobs[k]; }).find(function(j){ return j && j.state === 'running'; });
      var block = C.startBlock({ runner: await store.getRunner(), control: await store.getControl(), job: running, now: now });
      if (block) { await store.setCommand(id, { status: 'refused', why: block, doneAt: now }); return; }

      var date = C.kstDate(now);
      var key = C.jobKey('menso_read', date, C.nextRound(jobs, 'menso_read', date));
      var range = C.dateRange(cmd.from, now);
      await store.setJob(key, { state: 'running', recipe: 'menso_read', trigger: 'menso', by: cmd.by || '', at: now, cmd: id, from: range.from, to: range.to });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'ebut'; }));
        var patch = { state: 'stopped', endedAt: 0, notes: '' };
        if (r.state !== 'ok') patch.notes = '이벗: ' + r.msg;
        else {
          await store.setCommand(id, { status: 'reading', jobKey: key });
          try {
            patch.menso = await deps.mensoPreview(range);
            patch.notes = patch.menso.blockers.join(' / ');
            if (!patch.menso.blockers.length) patch.state = 'done';
          } catch (e) { patch.notes = '주문 읽기 실패: ' + String((e && e.message) || e); }
        }
        patch.endedAt = deps.now();
        await store.setJob(key, patch);
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', endedAt: deps.now(), notes: '오류: ' + String((e && e.message) || e) }).catch(function(){});
        throw e;
      }
    }

    /* 지난 매칭 기록은 상품명으로 묶여 오는데, 상품명의 [ ] . / 는 Firebase 이름표로 못 씀. 목록으로 바꿔 저장 */
    function histList(h){ return Array.isArray(h) ? h : Object.keys(h || {}).map(function(n){ return { name: n, rows: h[n] }; }); }
    async function readMatch(range){
      var data = await deps.matchRead(range);
      data.history = histList(data.history);
      data.readAt = deps.now();
      await store.setMatch('data', data);
      return data;
    }
    /* 매칭 저장: 사람이 확정하고 「이벗에 저장」을 누른 상품만 하나씩 한 번. 실패하면 거기서 멈추고 다시 보내지 않음. 끝나면 다시 읽어 대조 */
    var MATCH_SAVE_MAX = 30;
    async function runMatchSave(id, cmd){
      if (deps.now() - cmd.at > C.RELAY_TTL) { await store.setCommand(id, { status: 'expired', doneAt: deps.now() }); return; }
      var jobs = await bizemBlock(id);
      if (!jobs) return;
      var list = (cmd.items || []).slice(0, MATCH_SAVE_MAX), now = deps.now(), date = C.kstDate(now), key = C.jobKey('match_save', date, C.nextRound(jobs, 'match_save', date));
      async function end(state, notes, result){
        await store.setJob(key, { state: state, step: '', endedAt: deps.now(), notes: notes, result: result || null });
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      }
      await store.setJob(key, { state: 'running', recipe: 'match_save', trigger: 'relay', by: cmd.by || '', at: now, cmd: id, step: '이벗 매칭 창 여는 중', total: list.length, notes: '' });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        if (!list.length) return end('stopped', '저장할 상품이 없습니다');
        var r = C.siteState('ebut', await deps.ebutMatchPage());
        if (r.state !== 'ok') return end('stopped', '이벗: ' + r.msg);
        var saved = 0, fail = '', tried = [];
        for (var i = 0; i < list.length; i++) {
          var it = list[i], res;
          await store.setJob(key, { step: '매칭 저장 ' + (i + 1) + '/' + list.length, done: i });
          try { res = await deps.ebutGo('matchSave', { name: it.name, opt: it.opt, qty: it.qty, picks: it.picks }); }
          catch (e) { res = { ok: false, msg: '응답이 끊겼습니다. 저장됐을 수 있으니 이벗에서 먼저 확인해 주세요 (' + String((e && e.message) || e) + ')' }; }
          tried.push({ it: it, ok: !!res.ok });
          await store.setMatch('drafts/' + it.key + '/saved', { ok: !!res.ok, msg: res.msg || '', at: deps.now() });
          if (!res.ok) { fail = it.name + ' — ' + (res.msg || '저장 안 됨'); break; }
          saved++;
        }
        await store.setJob(key, { step: '다시 읽어 대조 중', done: saved });
        var open = -1, fixed = 0;
        try {
          var data = await readMatch(C.dateRange('', deps.now()));
          var still = function(it){ return (data.items || []).some(function(x){ return x.name === it.name && x.opt === it.opt && Number(x.qty) === Number(it.qty); }); };
          open = tried.filter(function(t){ return t.ok && still(t.it); }).length;
          /* 결과가 애매했던 상품도 다시 읽어 미매칭에서 빠졌으면 저장된 것 */
          for (var k = 0; k < tried.length; k++) {
            if (tried[k].ok || still(tried[k].it)) continue;
            await store.setMatch('drafts/' + tried[k].it.key + '/saved', { ok: true, msg: '저장됨 (다시 읽어 확인)', at: deps.now() });
            fixed++; saved++;
          }
          if (fixed) fail = '';
        } catch (e) { open = -1; }
        var result = { saved: saved, total: list.length, stillOpen: open };
        if (fail) return end('stopped', '저장 멈춤: ' + fail + (saved ? ' (앞의 ' + saved + '건은 저장됨)' : ''), result);
        if (saved < list.length) return end('stopped', '저장 결과가 애매했던 상품은 다시 읽어 보니 저장돼 있었습니다. 남은 ' + (list.length - saved) + '건은 다시 눌러 주세요', result);
        await end(open > 0 ? 'stopped' : 'done', open > 0 ? '저장했지만 아직 미매칭으로 보이는 상품 ' + open + '건. 이벗에서 확인해 주세요' : open < 0 ? '저장했지만 다시 읽지 못해 대조하지 못했습니다' : '', result);
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', step: '', endedAt: deps.now(), notes: '오류: ' + String((e && e.message) || e) + '. 이벗에서 먼저 확인해 주세요' }).catch(function(){});
        throw e;
      }
    }

    /* 매칭 화면 자료: 이벗에서 읽어 secretary/match 에 둔다. 이벗에 쓰지 않음 */
    async function runMatch(id, cmd){
      var now = deps.now();
      if (C.runnerState(await store.getRunner(), now) !== 'on') { await store.setCommand(id, { status: 'refused', why: '상시 컴퓨터가 꺼져 있습니다', doneAt: now }); return; }
      await store.setCommand(id, { status: 'reading' });
      try {
        var ebut = C.SITES.find(function(s){ return s.id === 'ebut'; }), r = C.siteState('ebut', await deps.openSite(ebut));
        if (r.state !== 'ok') { await store.setCommand(id, { status: 'refused', why: '이벗: ' + r.msg, doneAt: deps.now() }); return; }
        if (cmd.type === 'match_search') {
          await store.setMatch('search/' + id, { text: cmd.text || '', rows: await deps.matchSearch(cmd.text || ''), at: deps.now() });
        } else {
          await readMatch(C.dateRange(cmd.from, now));
        }
        await store.setCommand(id, { status: 'done', doneAt: deps.now() });
      } catch (e) {
        await store.setCommand(id, { status: 'refused', why: String((e && e.message) || e), doneAt: deps.now() });
      }
    }

    /* 사은품 세팅 (대표님 2026-11-08): 설정(기간 = 주문 결제일시, 묶음출력 메모, 가격대 → 사은품)대로
       gift_check = 오늘 출력차수·주문을 읽어 차수 × 가격대별 묶음 수만 계산 (이벗에 쓰지 않음)
       gift_add   = 사람이 그 건수를 보고 누름. 다시 읽어 같은 건수일 때만 묶음마다 이벗 사은품추가(조건10) 한 번씩,
                    넣은 뒤 그 주문에 사은품 줄이 생겼는지 다시 읽어 확인. 안 생기면 멈추고 다시 보내지 않음.
       이미 사은품 줄이 있는 주문은 계산에서 빠지므로 두 번 들어가지 않음. 작업 기록에는 건수만 남김 */
    function giftLib(){ return (typeof window !== 'undefined' && window.SECRETARY_GIFT) || (typeof require === 'function' ? require('./secretary_gift.js') : null); }
    async function giftPlan(set){
      var G = giftLib(), data = await deps.giftRead({ cust: C.MENSO_CUST, date: C.kstDate(deps.now()) });
      var p = G.plan(set, data.chasu || [], data.rows || []);
      return { p: p, chasu: data.chasu || [] };
    }
    function giftSummary(p){
      return { orders: p.orders, skip: p.skip, chasu: p.chasu, groups: p.groups.map(function(g){ return { key: g.key, ivno: g.ivno, memo: g.memo, tier: g.tier, label: g.label, orders: g.nos.length, n: g.haps.length }; }) };
    }
    async function runGiftCheck(id, cmd){
      if (!(await bizemBlock(id))) return;
      var G = giftLib(), why = G.check(cmd.set);
      if (why.length) { await store.setCommand(id, { status: 'refused', why: why[0], doneAt: deps.now() }); return; }
      await store.setCommand(id, { status: 'reading' });
      try {
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'ebut'; }));
        if (r.state !== 'ok') { await store.setCommand(id, { status: 'refused', why: '이벗: ' + r.msg, doneAt: deps.now() }); return; }
        var g = await giftPlan(cmd.set);
        await store.setCommand(id, { status: 'done', gift: Object.assign(giftSummary(g.p), { at: deps.now() }), doneAt: deps.now() });
      } catch (e) {
        await store.setCommand(id, { status: 'refused', why: String((e && e.message) || e), doneAt: deps.now() });
      }
    }
    async function runGiftAdd(id, cmd){
      if (deps.now() - cmd.at > C.RELAY_TTL) { await store.setCommand(id, { status: 'expired', doneAt: deps.now() }); return; }
      var jobs = await bizemBlock(id);
      if (!jobs) return;
      var G = giftLib(), now = deps.now(), date = C.kstDate(now), key = C.jobKey('gift_add', date, C.nextRound(jobs, 'gift_add', date));
      var result = { groups: 0, added: 0 };
      async function end(state, notes){
        await store.setJob(key, { state: state, step: '', endedAt: deps.now(), notes: notes, result: result });
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() });
      }
      function why(e){ return String((e && e.message) || e); }
      await store.setJob(key, { state: 'running', recipe: 'gift_add', trigger: 'relay', by: cmd.by || '', at: now, cmd: id, set: cmd.setId || '', step: '이벗 확인 중', notes: '' });
      try {
        await store.setCommand(id, { status: 'started', jobKey: key, startedAt: now });
        var bad = G.check(cmd.set);
        if (bad.length) return end('stopped', bad[0]);
        var r = await checkOne(C.SITES.find(function(s){ return s.id === 'ebut'; }));
        if (r.state !== 'ok') return end('stopped', '이벗: ' + r.msg);
        await store.setJob(key, { step: '대상 주문 다시 확인 중' });
        var g = await giftPlan(cmd.set);
        if (!G.sameCounts(G.counts(g.p), cmd.expect)) return end('stopped', '대상 건수가 화면에서 본 것과 달라져 넣지 않았습니다. 미리 보기를 다시 해 주세요');
        var groups = g.p.groups;
        result.total = groups.reduce(function(s, x){ return s + x.haps.length; }, 0);
        for (var i = 0; i < groups.length; i++) {
          var gr = groups[i], tier = cmd.set.tiers[gr.tier], label = gr.ivno + '차' + (gr.memo ? '(' + gr.memo + ')' : '') + ' · ' + gr.label;
          await store.setJob(key, { step: '사은품 넣는 중 · ' + label + ' ' + gr.haps.length + '건', result: result });
          var out;
          try { out = await deps.ebutGo('giftAdd', { ivdate: gr.ivdate, ivno: gr.ivno, site: gr.site, nos: gr.nos, hap: gr.haps.length, items: tier.items }); }
          catch (e) { return end('stopped', label + ': 넣는 중 끊겼습니다. 들어갔을 수 있으니 다시 누르지 말고 이벗에서 먼저 확인해 주세요 (' + why(e) + ')'); }
          if (!out.ok) return end('stopped', label + ': ' + (out.said || '이벗이 받지 않았습니다'));
          /* 넣은 뒤 그 주문들에 사은품 줄이 생겼는지 */
          var after = await giftPlan(cmd.set).catch(function(){ return null; });
          var still = after ? after.p.groups.filter(function(x){ return x.key === gr.key; }).reduce(function(s, x){ return s + x.haps.length; }, 0) : -1;
          if (still !== 0) return end('stopped', label + ': 사은품추가를 보냈는데 ' + (still < 0 ? '결과를 다시 읽지 못했습니다' : '아직 사은품 줄이 없는 묶음이 ' + still + '건 있습니다') + '. 다시 보내지 않았습니다. 이벗 작업내역에서 확인해 주세요' + (out.said ? ' (이벗: ' + out.said + ')' : ''));
          result.groups++; result.added += gr.haps.length;
        }
        await end('done', '');
      } catch (e) {
        await store.setJob(key, { state: 'interrupted', step: '', endedAt: deps.now(), result: result, notes: '오류: ' + why(e) + '. 이벗에서 먼저 확인해 주세요' }).catch(function(){});
        await store.setCommand(id, { status: 'done', jobKey: key, doneAt: deps.now() }).catch(function(){});
        throw e;
      }
    }

    async function process(id, cmd){
      if (!(await store.claimCommand(id))) return;
      var now = deps.now();
      /* sealed = 잠긴 파일(송장업로드). 처리하지 않는 명령에서도 바로 지움 */
      if (C.commandExpired(cmd, now)) { await store.setCommand(id, { status: 'expired', sealed: null, doneAt: now }); return; }
      if (printing) { await store.setCommand(id, { status: 'refused', why: '송장출력 중입니다', sealed: null, doneAt: now }); return; }
      if (cmd.type === 'start') return runStart(id, cmd);
      if (cmd.type === 'menso') return runMenso(id, cmd);
      if (cmd.type === 'match_read' || cmd.type === 'match_search') return runMatch(id, cmd);
      if (cmd.type === 'bizem_check') return runBizemCheck(id);
      if (cmd.type === 'bizem_survey') return runBizemSurvey(id);
      if (cmd.type === 'bizem_invoice') return runBizemInvoice(id, cmd);
      if (cmd.type === 'bizem_collect') return runBizemCollect(id, cmd);
      if (cmd.type === 'bizem_confirm') return runBizemConfirm(id, cmd);
      if (cmd.type === 'bizem_form') return runBizemForm(id);
      if (cmd.type === 'match_save') return runMatchSave(id, cmd);
      if (cmd.type === 'ebut_check') return runEbutCheck(id);
      if (cmd.type === 'ebut_collect') return runEbutCollect(id, cmd);
      if (cmd.type === 'bizem_import') return runBizemImport(id, cmd);
      if (cmd.type === 'gift_check') return runGiftCheck(id, cmd);
      if (cmd.type === 'gift_add') return runGiftAdd(id, cmd);
      await store.setCommand(id, { status: 'refused', why: '모르는 명령', doneAt: now });
    }

    /* 명령은 한 번에 하나씩. 실패해도 다음 명령을 막지 않음 */
    function handleCommand(id, cmd){
      var run = chain.then(function(){ return process(id, cmd); });
      chain = run.catch(function(){});
      return run;
    }

    return { claim: claim, checkSites: checkSites, handleCommand: handleCommand, handleCall: handleCall, handleLogin: handleLogin, uploadMenso: uploadMenso, holding: holding, mustStay: mustStay, printWatch: printWatch, keepAlive: keepAlive };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createRunner: createRunner };
  else root.SECRETARY_RUNNER = { createRunner: createRunner };
})(typeof window !== 'undefined' ? window : this);
