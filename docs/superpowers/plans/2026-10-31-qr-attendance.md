# QR 출퇴근기록기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객사별 QR로 출퇴근을 기록하고, 고객사별로 분리해 조회·엑셀·주기 메일까지 되는 메뉴를 만든다.

**Architecture:** 공개 폰 화면(`qr_in.html`)은 DB에 접근하지 않고 공개 서버 함수만 부른다. 관리 화면(`qr_attend.html`)은 구글 로그인 후 규칙이 허용한 자기 고객사만 읽고, 기록 변경은 서버 함수로 한다. 판단 로직은 순수 함수(`logic.js`)로 분리해 시험한다.

**Tech Stack:** Firebase Functions v2 (Node 22), Realtime Database, nodemailer, exceljs, `node:test`, 순수 HTML/JS + firebase compat 10.13.2, qrcodejs 1.0.0

**Spec:** `docs/superpowers/specs/2026-10-31-qr-attendance-design.md`

## Global Constraints

- 화면·메일·주석·커밋 메시지는 한국어.
- 함수 리전 `asia-northeast3`, 묶음 이름 `qra`, 폴더 `functions-qra`.
- 새 페이지 `</body>` 앞에 `<script src="/mm_copy.js" defer></script>`.
- 직원에게 「기록이 삭제된다」고 안내하지 않는다. 화면 문구는 정확히 「이 화면에는 이번 달 1일부터 말일까지의 기록만 보입니다.」
- 시각 기준은 서버 시간, 날짜 경계는 한국 시간.
- `qr_in.html` 에는 `wms_access.js` 를 넣지 않는다.
- 비밀값 입력·발급은 대표님이 직접 한다. 코드·로그·커밋에 값을 남기지 않는다. 함수 로그에 이름·휴대폰번호를 남기지 않는다.
- 사용자 입력을 화면에 넣을 때는 항상 이스케이프한다. 로고는 `data:image/` 로 시작할 때만 표시한다.

## Review Focus

1. 카카오톡 인앱 브라우저처럼 저장소가 비거나 막힌 폰: 이름·번호 재입력으로 정상 기록되고, 등록된 사람이면 동의를 다시 묻지 않는다. (Task 1)
2. 달을 넘긴 근무(10/31 22:00 출근, 11/1 06:00 퇴근): 출근 달의 기록이 닫히고 11월에 새 기록이 생기지 않는다. (Task 1)
3. 휴대폰번호 표기 차이(`010-1234-5678`, `010 1234 5678`, `+82 10-1234-5678`)와 이름 띄어쓰기(`김 민지`): 같은 사람으로 본다. (Task 1)
4. 폰 화면을 열어 둔 사이 QR 재발급·고객사 중지: 버튼을 누르면 오류 코드 대신 「담당자에게 새 QR을 요청해 주세요」 안내가 나오고 기록되지 않는다. (Task 1, 3)
5. 담당자가 퇴근을 출근보다 앞으로 고치거나, 근무 중 기록의 출근 시각을 고침: 앞선 시각은 거부하고, 열린 기록 수정은 `open` 과 맞게 갱신한다. (Task 1, 4)

---

### Task 1: 묶음 뼈대와 순수 로직

**Files:**
- Create: `functions-qra/package.json`, `functions-qra/index.js`(빈 입구), `functions-qra/logic.js`, `functions-qra/test/logic.test.js`
- Modify: `firebase.json`(functions 배열에 `qra`), `.github/workflows/firebase-functions-deploy.yml`(`ALL="ads picktalk qra settle speech"`)

**Interfaces — Produces (`logic.js`):**
- `normalizePhone(s) -> '01012345678' | null` — 숫자만 남기고 `82` 시작은 `0`으로, `^01[016789]\d{7,8}$` 아니면 null
- `normalizeName(s) -> string` — 제어문자·공백 제거, 20자 제한
- `workerId(cid, phone) -> string` — `sha256(cid+':'+phone)` 16진 앞 24자
- `hashToken(t) -> string` — sha256 16진
- `checkCompany(cid, company) -> { ok:true } | { ok:false, message }` — 없거나 `off` 면 message 「담당자에게 새 QR을 요청해 주세요」
- `resolveIdentity(worker, { name, phone, token }) -> { result:'token'|'match'|'new'|'nameMismatch'|'needPhone' }` — 토큰 해시 일치면 `token`, 번호와 이름 일치면 `match`, 번호로 찾은 직원이 없으면 `new`, 이름 불일치면 `nameMismatch`, 토큰·번호 모두 없으면 `needPhone`
- `decidePunch(open, action, now) -> { kind:'in'|'out'|'dup'|'stale', closeStale:boolean }` — `open` 은 `{logId,month,in,lastAt,lastType}|null`, `action` 은 `'in'|'out'`, 상수 `STALE_MS=18*3600e3`, `DUP_MS=60000`
- `nextAction(open, now) -> 'in'|'out'`
- `monthOf(ms) -> 'YYYY-MM'`(한국 시간), `dayOf(ms) -> 'YYYY-MM-DD'`
- `duePeriod(freq, now) -> { id, fromMs, toMs, label } | null`
- `monthsInRange(fromMs, toMs) -> ['YYYY-MM', ...]`
- `monthsToPurge(months, now) -> [...]` — 지금 달 기준 36개월 전 달부터 남긴다
- `validateEdit({ inMs, outMs }, now) -> { ok:true } | { ok:false, message }`
- `parseRecipients(s|[]) -> { valid:[], invalid:[] }` — 쉼표·세미콜론·줄바꿈 구분
- `workMinutes(log) -> number|null`, `summarize(logs) -> { people, totalMinutes, noout }`

- [ ] **Step 1: 실패하는 시험 작성** — `test/logic.test.js` (`node:test`, `assert`). 시각은 `Date.parse('2026-10-31T22:00:00+09:00')` 식으로 쓴다.

```js
// 번호·이름
assert.equal(normalizePhone('010-1234-5678'), '01012345678');
assert.equal(normalizePhone('010 1234 5678'), '01012345678');
assert.equal(normalizePhone('+82 10-1234-5678'), '01012345678');
assert.equal(normalizePhone('02-123-4567'), null);
assert.equal(normalizeName(' 김 민지 '), '김민지');
// 신원: 저장소가 빈 폰도 번호·이름이 맞으면 match (동의 생략)
const w = { name:'김민지', phone:'01012345678', tokens:{ [hashToken('T')]:{at:1} } };
assert.equal(resolveIdentity(w, { token:'T' }).result, 'token');
assert.equal(resolveIdentity(w, { name:'김 민지', phone:'010-1234-5678' }).result, 'match');
assert.equal(resolveIdentity(w, { name:'이민지', phone:'01012345678' }).result, 'nameMismatch');
assert.equal(resolveIdentity(null, { name:'김민지', phone:'01012345678' }).result, 'new');
assert.equal(resolveIdentity(null, { name:'김민지' }).result, 'needPhone');
// 회사 상태
assert.equal(checkCompany('c', { off:true }).message, '담당자에게 새 QR을 요청해 주세요');
assert.equal(checkCompany('c', null).ok, false);
// 출퇴근 판단
const t = Date.parse('2026-10-31T22:00:00+09:00');
const open = { logId:'L', month:'2026-10', in:t, lastAt:t, lastType:'in' };
assert.deepEqual(decidePunch(null, 'in', t), { kind:'in', closeStale:false });
assert.equal(decidePunch(null, 'out', t).kind, 'stale');
assert.equal(decidePunch(open, 'in', t + 30e3).kind, 'dup');
assert.equal(decidePunch(open, 'in', t + 120e3).kind, 'stale');
assert.equal(decidePunch(open, 'out', Date.parse('2026-11-01T06:00:00+09:00')).kind, 'out');   // 달 넘김 퇴근
assert.deepEqual(decidePunch(open, 'in', t + 18*3600e3), { kind:'in', closeStale:true });       // 18시간 정각부터 미기록
assert.equal(decidePunch(open, 'out', t + 18*3600e3).kind, 'stale');
assert.equal(nextAction(open, t + 3600e3), 'out');
assert.equal(nextAction(open, t + 18*3600e3), 'in');
// 달·날 경계 (한국 시간)
assert.equal(monthOf(Date.parse('2026-10-31T15:30:00Z')), '2026-11');
// 메일 기간
const at = (s) => Date.parse(s + '+09:00');
assert.equal(duePeriod('daily', at('2026-11-01T07:00:00')).id, 'D2026-10-31');
assert.equal(duePeriod('weekly', at('2026-11-02T07:00:00')).id, 'W2026-10-26');
assert.equal(duePeriod('weekly', at('2026-11-02T07:00:00')).fromMs, at('2026-10-26T00:00:00'));
assert.equal(duePeriod('weekly', at('2026-11-02T07:00:00')).toMs, at('2026-11-02T00:00:00'));
assert.equal(duePeriod('weekly', at('2026-11-03T07:00:00')), null);
assert.equal(duePeriod('monthly', at('2027-01-01T07:00:00')).id, 'M2026-12');
assert.equal(duePeriod('monthly', at('2026-11-02T07:00:00')), null);
assert.equal(duePeriod('off', at('2026-11-01T07:00:00')), null);
assert.deepEqual(monthsInRange(at('2026-10-26T00:00:00'), at('2026-11-02T00:00:00')), ['2026-10','2026-11']);
// 보관
assert.deepEqual(monthsToPurge(['2023-09','2023-10','2026-10'], at('2026-10-31T07:00:00')), ['2023-09']);
// 수정 검증
assert.equal(validateEdit({ inMs:t, outMs:t - 60e3 }, t).ok, false);
assert.equal(validateEdit({ inMs:t + 3600e3 }, t).ok, false);   // 미래 출근 거부
assert.equal(validateEdit({ inMs:t, outMs:t + 3600e3 }, t + 3600e3).ok, true);
// 수신자
assert.deepEqual(parseRecipients('a@b.kr; c@d.com,\nbad').valid, ['a@b.kr','c@d.com']);
assert.deepEqual(parseRecipients('a@b.kr; bad').invalid, ['bad']);
// 요약
assert.deepEqual(summarize([
  { wid:'A', in:0, out:90*60e3, status:'done' },
  { wid:'A', in:0, out:null, status:'noout' },
  { wid:'B', in:0, out:30*60e3, status:'done' },
]), { people:2, totalMinutes:120, noout:1 });
```

- [ ] **Step 2: 실패 확인** — `cd functions-qra && node --test test/` → FAIL (모듈 없음)
- [ ] **Step 3: `logic.js` 구현, `package.json`** — `engines.node 22`, 의존성 `firebase-admin ^12.6.0`, `firebase-functions ^6.0.0`, `nodemailer`, `exceljs`, 스크립트 `"test":"node --test test/"`. `npm install` 로 `package-lock.json` 생성(CI 가 `npm ci` 사용). `firebase.json` 항목은 다른 묶음과 같은 형식.
- [ ] **Step 4: 통과 확인** — `node --test test/` → 전부 PASS
- [ ] **Step 5: 커밋** — `QR 출퇴근: functions-qra 뼈대와 판단 로직`

### Task 2: 엑셀과 메일

**Files:** Create `functions-qra/mail.js`, `functions-qra/test/mail.test.js`

**Interfaces — Consumes:** `summarize`, `workMinutes`, `dayOf` / **Produces:**
- `buildWorkbook(company, logs) -> Promise<Buffer>` — 시트 `근태일지`(날짜, 이름, 휴대폰, 출근, 퇴근, 근무시간, 비고), `사람별 합계`(이름, 휴대폰, 근무일수, 총 근무시간, 퇴근 미기록). 시각은 한국 시간 `HH:mm`, 출근 시각 순. 비고: `noout`→「퇴근 미기록」, 수정 이력 있음→「수정됨」
- `mailContent(company, period, summary) -> { subject, html, text }` — 제목 `[{회사명}] 근태일지 {기간}`, 로고가 있으면 cid 첨부로 본문 표시, 회사명 등 값은 HTML 이스케이프
- `sendReport(transport, company, period, logs) -> Promise<void>` — 기록이 없으면 첨부 없이 본문 「기록 없음」, 수신 `mail.to`, 참조 `mail.cc`
- `makeTransport(user, pass)` — nodemailer gmail

- [ ] **Step 1: 실패하는 시험 작성** — `buildWorkbook` 결과를 exceljs 로 다시 읽어 시트 이름 2개, 헤더 7열, `noout` 행 비고 「퇴근 미기록」, 합계 시트 값 확인. `=SUM(1)` 이름이 문자열로 남는지 확인(수식 아님). `sendReport` 는 가짜 transport(`sendMail` 기록)로 `to`·`cc` 전달, 빈 기록이면 `attachments` 에 xlsx 없음, `<b>` 든 회사명이 이스케이프되는지 확인.
- [ ] **Step 2: 실패 확인** — `node --test test/` → FAIL
- [ ] **Step 3: `mail.js` 구현**
- [ ] **Step 4: 통과 확인** — `node --test test/` → PASS
- [ ] **Step 5: 커밋** — `QR 출퇴근: 근태일지 엑셀과 메일 본문`

### Task 3: 공개 함수 `qraInfo`, `qraPunch`

**Files:** Create `functions-qra/public.js`, Modify `functions-qra/index.js`

**Interfaces — Consumes:** Task 1 전부. **Produces (onCall, 비로그인):**
- `qraInfo({ key, token }) -> { company:{ name, site, logo }, consentVer, me:{ name, next:'in'|'out', records:[{ in, out, status }] } | null }`
- `qraPunch({ key, action, name, phone, token, dev, agree }) -> { kind, at, next, token?, name, records, needConsent? }`
- 오류: `HttpsError` 메시지는 화면에 그대로 띄울 한국어. 코드 노출 금지.

**처리 순서 (`qraPunch`):**
1. IP당 분당 30회 제한(인스턴스 메모리 `Map`). `req.rawRequest.ip`. 초과 시 「잠시 후 다시 시도해 주세요」.
2. `qra/keys/{key}` → `cid`, `companies/{cid}` → `checkCompany`. 실패 시 그 메시지로 `permission-denied`.
3. 토큰만 온 경우 `qra/tokens/{cid}/{해시}` → `wid` 로 직원을 찾는다(직원 전체 조회 금지). 번호가 오면 `workerId` 로 찾는다. `resolveIdentity` 결과로 분기: `needPhone`→「휴대폰번호를 입력해 주세요」, `nameMismatch`→「등록된 정보와 다릅니다. 담당자에게 문의해 주세요」(등록 이름 비노출), `new` 또는 `consentVer` 낮음 + `agree` 없음→`{ needConsent:true }` 반환하고 기록 안 함.
4. `qra/open/{cid}/{wid}` 트랜잭션에서 `decidePunch`. 값 없는 `null` 재시도까지 처리. 결정은 트랜잭션 밖 변수에 담는다.
5. 트랜잭션 후 `kind` 별 다중 경로 쓰기:
   - `in`: `logs/{cid}/{monthOf(now)}/{새 id}` `{wid,name,phone,in:now,out:null,inDev:dev,status:'open'}`, `closeStale` 면 이전 기록 `status:'noout'`
   - `out`: 열린 기록의 `month` 로 `out`, `outDev`, `status:'done'` (달 넘김 대비 `month` 는 open 값 사용)
   - `dup`/`stale`: 쓰기 없이 현재 상태 반환
   - 공통: `workers/{cid}/{wid}` 의 `lastAt`, 새 토큰 발급 시 `tokens/{해시}` 와 `qra/tokens/{cid}/{해시}`
6. 이번 달 내 기록 조회는 `logs/{cid}/{month}` 를 `orderByChild('wid').equalTo(wid)`.

**`open` 값:** 출근 중 `{logId,month,in,lastAt,lastType:'in'}`, 퇴근 후 `{lastAt,lastType:'out'}`.

> 스펙 대비 추가: `qra/tokens/{cid}/{해시}` 는 토큰으로 직원을 바로 찾기 위한 색인이고, `open` 은 중복 판단을 위해 퇴근 후에도 마지막 동작을 남긴다. 둘 다 함수 전용이다.

- [ ] **Step 1: 시험 작성** — `test/public.test.js`. `public.js` 는 `makeHandlers(db, now)` 로 내보내 메모리 가짜 DB(`ref().once/transaction/update/orderByChild`)로 시험한다: 첫 출근은 `needConsent`, 동의 후 출근 기록·토큰 발급, 같은 토큰 재호출 시 동의 없이 퇴근, 토큰 없이 이름·번호로도 동의 없이 기록, `off` 회사는 안내 메시지로 거부, 달 넘김 퇴근 시 10월 기록이 `done` 이고 11월 기록 없음.
- [ ] **Step 2: 실패 확인** — `node --test test/` → FAIL
- [ ] **Step 3: `public.js` 구현, `index.js` 에 `exports.qraInfo`, `exports.qraPunch` 연결**
- [ ] **Step 4: 통과 확인** — `node --test test/` → PASS
- [ ] **Step 5: 커밋** — `QR 출퇴근: 공개 출퇴근 함수`

### Task 4: 관리 함수와 예약 작업

**Files:** Create `functions-qra/admin.js`, `functions-qra/test/admin.test.js`, Modify `functions-qra/index.js`

**Interfaces — Consumes:** `validateEdit`, `duePeriod`, `monthsToPurge`, `monthsInRange`, `buildWorkbook`, `sendReport`, `makeTransport`. **Produces (onCall, 로그인 필수):**
- `canManage(auth, cid) -> Promise<boolean>` — 슈퍼관리자 또는 `email_verified` + `qra/admins/{ekey}/{cid}`
- `qraEditLog({ cid, month, logId, inMs, outMs, remove, create:{ name, phone } }) -> { ok }` — 변경 전 값을 `edits/{push}` `{ at, by, in, out }` 로 보존. 근무 중 기록이면 `open` 갱신(퇴근 입력 시 `open` 해제), 삭제 시 `open` 도 해제
- `qraEditWorker({ cid, wid, name, remove }) -> { ok }` — 삭제해도 기록은 남긴다. 토큰 색인·`open` 정리
- `qraRotateKey({ cid }) -> { qrKey }` — 슈퍼관리자만. 이전 `keys` 삭제
- `qraExport({ cid, fromMs, toMs }) -> { base64, filename }` — 관리 화면 엑셀도 `buildWorkbook` 하나로 만든다
- `qraSendNow({ cid, fromMs, toMs }) -> { ok }` — `mailLog` 기록, `lastPeriod` 는 바꾸지 않음
- `qraMailTick` — `onSchedule('0 7-10 * * *', Asia/Seoul)`, `secrets:[GMAIL_USER, GMAIL_APP_PASSWORD]`, `timeoutSeconds:540`. 고객사별 try/catch, 하나가 실패해도 계속. 성공 시 `lastPeriod`·`lastError:null`, 실패 시 `lastError`·`mailLog`. 7시 회차에만 보관 삭제 실행(`monthsToPurge`, `lastAt` 3년 지난 `workers`와 그 토큰 색인, 달이 지난 `mailLog`). 메일 오류 로그에 수신자 외 개인정보 금지.

- [ ] **Step 1: 시험 작성** — 가짜 DB로: 다른 고객사 담당자 `canManage` false, 미인증 메일 false, 퇴근<출근 수정 거부, 수정 시 `edits` 보존, 근무 중 기록의 출근 시각 수정이 `open.in` 에 반영, 직원 삭제 후 기록 유지, `qraMailTick` 내부 함수 `runTick(db, transport, now)` 가 `lastPeriod` 같으면 재발송 안 함, 한 회사 발송 실패 시 다음 회사는 발송되고 `lastError` 기록.
- [ ] **Step 2: 실패 확인** — `node --test test/` → FAIL
- [ ] **Step 3: `admin.js` 구현, `index.js` 연결**
- [ ] **Step 4: 통과 확인** — `node --test test/` → PASS
- [ ] **Step 5: 커밋** — `QR 출퇴근: 관리 함수와 자동 메일`

### Task 5: DB 규칙과 페이지 등록

**Files:** Modify `database.rules.json`, `main/wms_pages.js`, `main/wms_login.html:436-441`, `main/index.html`(앱 타일)

**규칙 (`rules` 바로 아래 `qra`):** 슈퍼관리자식 `S`=`auth != null && root.child('superadmins/'+auth.uid).exists()`, 담당자식 `A`=`auth != null && auth.token.email_verified == true && root.child('qra/admins/'+auth.token.email.toLowerCase().replace('.',',')+'/'+$cid).exists()`.

| 경로 | `.read` | `.write` |
|---|---|---|
| `qra/companies/$cid` | `S\|\|A` | `S` |
| `.../site`, `.../logo`, `.../mail/freq`, `.../mail/to`, `.../mail/cc` | | `A` (`logo` 는 `newData.val().length < 210000`) |
| `qra/admins/$ekey` | `S` 또는 메일 키 본인 | `S` |
| `qra/keys` | `false` | `S` (등록 시 첫 쓰기) |
| `qra/workers/$cid`, `qra/logs/$cid`, `qra/mailLog/$cid` | `S\|\|A` | `false` |
| `qra/logs/$cid/$month` | | `.indexOn:['wid','in']` |
| `qra/open`, `qra/tokens` | `false` | `false` |

슈퍼관리자가 `qra` 전체 목록을 읽도록 `qra/companies` 에 `.read: S` 를 둔다.

- [ ] **Step 1: `database.rules.json` 수정 후 JSON 검사** — `node -e "JSON.parse(require('fs').readFileSync('database.rules.json'))"` → 오류 없음
- [ ] **Step 2: `wms_pages.js` 등록** — 새 그룹 `고객사 서비스`: `{key:'qr_attend',file:'qr_attend.html',label:'QR 출퇴근기록기 (고객사 관리·근태)',floor:1,gate:true,self:'자체 인증: qra/admins 또는 슈퍼관리자'}`, `{key:'qr_in',file:'qr_in.html',label:'└ QR 출퇴근 폰 화면 (직원용)',floor:0,gate:false,locked:'항상 공개',self:'서버 함수만 호출 — 잠그면 직원이 기록할 수 없음'}`. `WMS_MENU` 의 `APPS` 에 `{key:'qr_attend',name:'QR 출퇴근기록기',eng:'QR ATTENDANCE',subs:[{key:'qr_in'}]}`. `index.html` 앱 타일을 같은 형식으로 추가.
- [ ] **Step 3: `wms_login.html` 분기** — 거래처 확인 다음에 `qra/admins/{ek}` 존재 시 `/qr_attend.html` 로 이동.
- [ ] **Step 4: 커밋** — `QR 출퇴근: DB 규칙과 페이지 등록`

### Task 6: 폰 화면 `qr_in.html`

**Files:** Create `main/qr_in.html`

**Interfaces — Consumes:** `qraInfo`, `qraPunch`. firebase app·functions compat 만 싣는다. 저장소 키 `qra_t_{key 앞 8자}`(토큰), `qra_dev`(폰 식별값 `crypto.randomUUID()`), 모두 try/catch.

- [ ] **Step 1: 화면 구현** — 승인된 시안 그대로: 어두운 바탕(`#14171c`)·금색(`#c9ab6c`), 로고·회사명·현장명·현재 시각(1초 갱신)·이름칸·버튼, 그 아래 이번 달 내 기록, 안내 문구, 이용 순서 3단계. 첫 방문은 번호칸과 동의서(글머리 그대로, 회사명 삽입) 체크, 동의 없이 누르면 그 자리에 안내. 처리 중 버튼 잠금, 완료 시 큰 확인(「출근 08:57」). 키 없는 주소·무효 QR·오류는 안내 화면. 첫 화면 375×667 에서 버튼까지 스크롤 없이 보이고 가로 스크롤 없음.
- [ ] **Step 2: 함수 없이 화면 확인** — 프리뷰에서 `firebase.functions` 를 가짜로 바꿔 첫 방문·재방문·퇴근·오류 4상태를 375px 로 확인, 스크린샷
- [ ] **Step 3: 커밋** — `QR 출퇴근: 직원용 폰 화면`

### Task 7: 관리 화면 `qr_attend.html`

**Files:** Create `main/qr_attend.html`

**Interfaces — Consumes:** Task 4 함수 전부, 규칙. `<script src="/wms_access.js" data-page="qr_attend" data-floor="1">`. 고객사 목록은 슈퍼관리자면 `qra/companies`, 아니면 `qra/admins/{ek}`.

- [ ] **Step 1: 탭 구현**
  - **고객사(슈퍼관리자):** 회사명·현장명·로고·담당자 메일(쉼표 구분). 저장은 `companies`·`keys`·`admins` 다중 경로. `cid`, `qrKey` 는 `crypto.getRandomValues` 24자 영숫자. 담당자 메일 제거 시 `admins` 도 제거. 중지 토글.
  - **QR:** qrcodejs(`cdnjs`)로 `https://makewon.com/qr_in.html?key=…`. A4 안내문 인쇄(`@media print` 로 안내문만), QR 이미지 저장, 재발급은 확인창 후 `qraRotateKey`.
  - **기록:** 기간(기본 이번 달)·이름 검색, 근무시간·상태, 수정·수기 추가·삭제, 엑셀(`qraExport` base64 내려받기). 같은 날 한 `inDev` 에 이름 2개 이상이면 표시. 번호는 표에서 `010-****-5678` 로 가리고 엑셀에만 전체.
  - **직원:** 목록·이름 수정·삭제.
  - **메일:** 주기, 받는 사람·참조(여러 명, `parseRecipients` 와 같은 규칙으로 잘못된 주소 표시), 지금 보내기(기간 선택), 최근 발송 기록·`lastError`.
  - 로고는 canvas 로 긴 변 400px, 150KB 이하가 될 때까지 품질을 낮춰 data URL 로 저장.
- [ ] **Step 2: 화면 확인** — 프리뷰는 로그인 게이트로 막히므로 게이트를 지나는 실사용 확인은 Task 8 에서 한다. 여기서는 `node --check` 대신 페이지 안 스크립트 구문 오류 없음을 콘솔로 확인.
- [ ] **Step 3: 커밋** — `QR 출퇴근: 관리 화면`

### Task 8: 배포와 전체 시험

- [ ] **Step 1: 대표님 비밀값 입력 요청 후 대기** — 대표님이 직접 실행:
  - `firebase functions:secrets:set GMAIL_USER`
  - `firebase functions:secrets:set GMAIL_APP_PASSWORD`
- [ ] **Step 2: 규칙 배포** — live 규칙을 내려받아 레포와 비교해 `qra` 외 차이가 없을 때만 `firebase deploy --only database`
- [ ] **Step 3: main 머지·푸시** — hosting·`qra` 함수 CI 확인. 실패 시 `firebase deploy --only functions:qra` 또는 `--only hosting`
- [ ] **Step 4: 규칙 확인** — 비로그인 REST 로 `qra/logs`, `qra/workers`, `qra/keys`, `qra/open` 읽기가 모두 401/거부
- [ ] **Step 5: 전체 시험** — 시험용 고객사로 등록 → QR 인쇄 미리보기 → 폰 크기 화면 출근 → 퇴근 → 재방문 동의 생략 → 저장소 지운 뒤 이름·번호로 동의 생략 → 기록·엑셀 → 다른 계정에서 안 보임 확인 → 지금 보내기로 메일 수신(받는 사람·참조) → 시험 데이터 삭제. 슈퍼관리자 로그인이 필요한 단계는 대표님 브라우저에서 함께 진행한다.
- [ ] **Step 6: 메모리 갱신** — 프로젝트 메모리 추가·`MEMORY.md` 한 줄, 커밋
