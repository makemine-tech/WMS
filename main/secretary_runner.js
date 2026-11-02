/* ============================================================
   메이크창고 전담비서 — 헤드비서 실행기 (secretary.html?run=1 짝꿍, 브라우저·Node 공용, 2026-11-01)

   명령을 받아 정해진 작업만 한다. Firebase 와 탭은 deps 로 받는다.
     deps.store    claimRunner·getRunner·claimCommand·setCommand·getJobs·setJob·getControl·setSite
     deps.openSite 사이트 탭을 열어 도우미 ping 응답을 돌려줌. 안 되면 throw
     deps.relogin  로그인 화면에서 크롬이 채운 값으로 로그인 버튼을 한 번 누름. { tried, why }. 비밀번호는 다루지 않음
     deps.ezPreview({ from, to }) 곡물도감 검색 후 secretary_ez.preview 결과를 돌려줌
     deps.ezSearch(args)·deps.ezWrite(cmd, args) 합포 분할 화면(ez_split.html?remote=1)이 보낸 요청을 도우미로 전달
   저장은 합포 분할 화면에서 사람이 누른 요청(relay)으로만 한다. 그 밖의 작업은 읽기 전용.
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
    function holding(){ return printing || deps.now() < holdUntil; }

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
        await store.setJob(key, { state: 'stopped', step: '', endedAt: deps.now(), notes: '일괄합포제외 실패: ' + String((e && e.message) || e) + '. 저장됐을 수 있으니 시동으로 확인해 주세요' });
        throw e;
      }
    }
    /* 출력 진행 확인과 마무리는 멈춤·다른 작업과 상관없이 받음 */
    async function relayPrintAfter(cmd, args){
      printSeen = deps.now();
      var r = await deps.ezWrite(cmd, args);
      if (cmd === 'printEnd') { printing = false; holdUntil = deps.now() + C.RELAY_HOLD; }
      if (cmd === 'printClose' && !printing) { holdUntil = 0; printJob = ''; }
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
        printing = false; holdUntil = 0;
        if (printJob) await store.setJob(printJob, { state: 'stopped', endedAt: deps.now(), notes: '출력 화면이 닫혀 헤드비서가 마무리함. 남은 공급처는 출력 안 함. 이지어드민에서 확인 필요' });
        printJob = '';
        return true;
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
          var data = await deps.matchRead(C.dateRange(cmd.from, now));
          data.readAt = deps.now();
          await store.setMatch('data', data);
        }
        await store.setCommand(id, { status: 'done', doneAt: deps.now() });
      } catch (e) {
        await store.setCommand(id, { status: 'refused', why: String((e && e.message) || e), doneAt: deps.now() });
      }
    }

    async function process(id, cmd){
      if (!(await store.claimCommand(id))) return;
      var now = deps.now();
      if (C.commandExpired(cmd, now)) { await store.setCommand(id, { status: 'expired', doneAt: now }); return; }
      if (printing) { await store.setCommand(id, { status: 'refused', why: '송장출력 중입니다', doneAt: now }); return; }
      if (cmd.type === 'start') return runStart(id, cmd);
      if (cmd.type === 'menso') return runMenso(id, cmd);
      if (cmd.type === 'match_read' || cmd.type === 'match_search') return runMatch(id, cmd);
      await store.setCommand(id, { status: 'refused', why: '모르는 명령', doneAt: now });
    }

    /* 명령은 한 번에 하나씩. 실패해도 다음 명령을 막지 않음 */
    function handleCommand(id, cmd){
      var run = chain.then(function(){ return process(id, cmd); });
      chain = run.catch(function(){});
      return run;
    }

    return { claim: claim, checkSites: checkSites, handleCommand: handleCommand, handleCall: handleCall, holding: holding, printWatch: printWatch, keepAlive: keepAlive };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createRunner: createRunner };
  else root.SECRETARY_RUNNER = { createRunner: createRunner };
})(typeof window !== 'undefined' ? window : this);
