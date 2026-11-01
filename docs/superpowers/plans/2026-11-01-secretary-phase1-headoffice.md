# 전담비서 1단계: 헤드비서·확장·시동 페이지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰에서 시동을 길게 누르면 DMZOOT 의 헤드비서 탭이 이지어드민·이벗 탭을 열어 연결·로그인을 점검하고 폰에 결과를 보고한다. 송장은 건드리지 않는다.

**Architecture:** 판단은 브라우저·Node 공용 `secretary_core.js`, 실행은 의존성을 주입받는 `secretary_runner.js`, 화면은 `secretary.html` 한 장(`?run=1` 이면 헤드비서)이 맡는다. 확장은 헤드비서 탭 유지와 도우미 주입만 한다. 통신은 Firebase `secretary/*` 와 기존 도우미 postMessage 만 쓴다.

**Tech Stack:** 순수 JS, Firebase RTDB compat 10.13.2, 크롬 확장 MV3, Node `node:test`, Cloud Functions v2 스케줄, PowerShell 5.1.

**Spec:** `docs/superpowers/specs/2026-10-31-secretary-phase1-pc-design.md` (7장 2단계)

## Global Constraints

- 도우미에 보내는 명령은 `ping`·`read` 만. `commit`·`printGo`·`fill`·`printPrep` 등은 코드로 막는다.
- 비밀번호를 어디에도 저장하지 않는다. 수령자 이름·주소·전화번호를 올리지 않는다.
- 시동 명령 만료 10분, 23:30~00:30 시작 금지, 생존 신호 1분, 응답 없음 판정 60초.
- 대표님이 직접 연 탭에는 주입하지 않는다: `window.name` 이 `mkw_ez_tab`/`mkw_ebut_tab` 이고 opener 가 있을 때만.
- `secretary/*` 는 슈퍼관리자만 읽고 쓴다. 명령 종류는 정해진 값만 받는다.
- 화면 글은 한국어, 새 페이지에 `/mm_copy.js`, `tools/secretary_setup` 의 ps1·txt 는 BOM·CRLF.
- 스토어 수집기를 건드리지 않는다. TOOZ-GRAM 은 점검만.

## Review Focus

- 오래된 시동 명령(크롬이 오래 꺼진 뒤 복귀): 실행하지 않고 만료 표시 → Task 2 `expired command`.
- 같은 명령을 두 번 받음(새로고침, 재연결): 한 번만 처리 → Task 2 `handles a command once`.
- 다른 PC 에서 `?run=1`: 실행하지 않음 → Task 2 `refuses other runner`.
- 로그인 풀림·도우미 무응답: 멈추고 원인 보고, 다른 사이트 점검은 계속 → Task 2 `reports site failures`.
- 헤드비서 꺼짐: 폰 버튼이 꺼지고 🔴 → Task 1 `runnerState`.

---

### Task 1: 판단 모듈

**Files:** Create `main/secretary_core.js`, Test `tools/tests/secretary_core.test.js`

**Interfaces — Produces (`window.SECRETARY_CORE`, `module.exports`):**
- `HELPER_CMDS = ['ping','read']`, `assertSafeCmd(cmd)` 그 밖이면 throw
- `COMMAND_TYPES = ['start','pause','resume']`
- `runnerState(runner, now)` → `'on'`(3분 이내) `'off'`(그 외·없음)
- `commandExpired(cmd, now)` 10분 초과 또는 `at` 없음이면 true
- `quietHours(date)` 23:30~00:30 이면 true
- `startBlock({ runner, control, job, now })` → 막는 이유 문자열 또는 `''`
- `kstDate(now)` → `YYYY-MM-DD`, `jobKey(recipe, date, round)` → `레시피:날짜:회차`, `nextRound(jobs, recipe, date)`
- `SITES` 이지어드민·이벗 정의 `{ id, name, url, tab, helper }`, `RECIPES.check`

- [ ] 테스트 작성: 위 경계값(3분, 10분, 23:29/23:30/00:30/00:31), 금지 명령, 회차 증가
- [ ] 실패 확인 `node --test tools/tests/secretary_core.test.js`
- [ ] 구현, 통과 확인

### Task 2: 헤드비서 실행기

**Files:** Create `main/secretary_runner.js`, Test `tools/tests/secretary_runner.test.js`

**Interfaces:** `createRunner(deps)` → `{ handleCommand(id, cmd), checkSites(), claim() }`. `deps = { store, openSite(site), now(), runnerId, info }`. `store` 는 `claimRunner(id, info)`, `setCommand(id, patch)`, `claimCommand(id)`, `setJob(key, patch)`, `getJobs()`, `getControl()`, `setSite(id, patch)`. `openSite` 는 `{ ver, login, page }` 를 돌려주거나 throw.

- [ ] 테스트: `expired command`, `handles a command once`, `refuses other runner`, `reports site failures`, `start runs check and reports done`, `pause blocks start`, `quiet hours blocks start`
- [ ] 실패 확인, 구현, 통과 확인

### Task 3: 시동 페이지와 규칙

**Files:** Create `main/secretary.html`, Modify `main/wms_pages.js`, `database.rules.json`

- `wms_access.js` `data-page="secretary"` `data-floor="3"`. 메뉴 목록에는 숨김으로 등록.
- 전담비서 화면: 특이사항, 비서 카드, 길게 누르는 시동(1초), 멈춤, 사이트 상태, 최근 기록, 실행 PC 해제.
- `?run=1`: `navigator.locks` 로 탭 중복 차단, 1분 생존 신호, `commands` 구독, 탭 열기·postMessage 연결.
- 규칙: `secretary` 는 슈퍼관리자 전용, `commands/$id/type` 은 `COMMAND_TYPES` 만.

- [ ] 구현, 로컬에서 로그인 전 화면까지 확인(로그인 뒤는 DMZOOT 실사용으로 확인)

### Task 4: 크롬 확장

**Files:** Create `tools/secretary_ext/manifest.json`, `background.js`, `inject.js`, `mark.js`, Test `tools/tests/secretary_ext.test.js`

- 배경: 시작·1분 알람마다 `secretary.html?run=1` 탭 확인, 없으면 고정 탭으로 열기, `autoDiscardable:false`. 디스크의 manifest 판이 다르면 `chrome.runtime.reload()`.
- `inject.js` (MAIN world): 이름·opener 조건을 만족할 때만 도우미 스크립트 주입.
- `mark.js`: 헤드비서 페이지에 확장 판 표시.
- 테스트: 조건별 주입 여부, 대표님 탭 미주입.

### Task 5: 생존 감시

**Files:** Create `functions-settle/secretary_watch.js`, Modify `functions-settle/index.js`, Test `tools/tests/secretary_watch.test.js`

- `watchDecision(runner, watch, now)` 순수 함수: 꺼짐·복귀 때만 기록. 5분 스케줄 `secretaryWatch` 가 `secretary/watch`·`secretary/notes` 에 남긴다.

### Task 6: 설치 마법사

**Files:** Modify `tools/secretary_setup/install.ps1`, `uninstall.ps1`, `guard.ps1`, `common.ps1`, `먼저읽기.txt`

- 확장을 드롭박스 폴더에 함께 두고 `%LOCALAPPDATA%\MakewonSecretary\extension` 으로 복사. 지킴이가 새 판이면 복사.
- 체크리스트에 개발자 모드·압축해제 설치 안내 추가, `-Sandbox` 시험 통과.

### Task 7: 검증·배포

- [ ] `node --test tools/tests/` 전체 통과, 독립 검토 한 번
- [ ] 커밋 → main 푸시, 드롭박스 복사, 규칙·함수 배포 확인
- [ ] DMZOOT 에서 설치.cmd 재실행 후 폰 LTE 로 P1·P1b 시험 안내
