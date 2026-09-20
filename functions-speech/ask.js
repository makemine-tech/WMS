/* ===========================================================
   창고 AI 질문 — askWarehouse
     입력  { wid, question, history: [{q, a}, …] }
     출력  { ok, answer, ms }
   Claude 가 ask_tools.js 의 조회 도구로 창고를 직접 찾아보고 답한다 (읽기 전용 — 입출고는 하지 않는다).
   숫자(파렛트 수·빈칸 수)는 도구가 계산하므로 AI 가 세다 틀릴 일이 없다.

   인증 — ID 페더레이션(WIF): 저장해 둘 API 키가 없다.
     이 함수의 서비스 계정으로 구글이 서명한 ID 토큰을 메타데이터 서버에서 받아
     Anthropic 에 내밀면 몇 분짜리 접근 토큰을 준다 (SDK 가 만료 전에 알아서 다시 받는다).
     필요한 값은 .env 의 ANTHROPIC_FEDERATION_RULE_ID / ANTHROPIC_ORGANIZATION_ID /
     ANTHROPIC_SERVICE_ACCOUNT_ID / ANTHROPIC_WORKSPACE_ID (비밀이 아니라 식별자다).
     ASK_SERVICE_ACCOUNT 에 이 함수를 돌릴 구글 서비스계정 이메일을 넣는다.
   예비: 환경변수 ANTHROPIC_API_KEY 가 있으면 그 키를 쓴다 (페더레이션을 안 쓸 때만).
=========================================================== */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk').default;
const { betaTool } = require('@anthropic-ai/sdk/helpers/beta/json-schema');
const { oidcFederationProvider } = require('@anthropic-ai/sdk/lib/credentials/oidc-federation');
const T = require('./ask_tools');

if (!admin.apps.length) admin.initializeApp();

const FUNC_REGION = 'asia-southeast1';
const ASK_MODEL = 'claude-opus-5';
const WIF_RULE = defineString('ANTHROPIC_FEDERATION_RULE_ID', { default: '' });
const WIF_ORG = defineString('ANTHROPIC_ORGANIZATION_ID', { default: '' });
const WIF_SVAC = defineString('ANTHROPIC_SERVICE_ACCOUNT_ID', { default: '' });
const WIF_WS = defineString('ANTHROPIC_WORKSPACE_ID', { default: '' });

/* 구글이 서명한 이 함수의 ID 토큰 — format=full 이라야 email 클레임이 들어간다 */
const META_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity'
  + '?audience=https://api.anthropic.com&format=full';
async function googleIdentityToken() {
  const r = await fetch(META_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error('구글 메타데이터 서버에서 ID 토큰을 받지 못했어요 (' + r.status + ')');
  return (await r.text()).trim();
}

/* 받은 접근 토큰은 만료 1분 전까지 재사용 — 질문 하나에 API 요청이 여러 번이라 매번 교환하면 느리다 */
let _fedProvider = null, _fedToken = null;
function federationCredentials() {
  if (!_fedProvider) {
    _fedProvider = oidcFederationProvider({
      identityTokenProvider: googleIdentityToken,
      federationRuleId: WIF_RULE.value(),
      organizationId: WIF_ORG.value(),
      serviceAccountId: WIF_SVAC.value() || undefined,
      workspaceId: WIF_WS.value() || undefined,
      baseURL: 'https://api.anthropic.com',
      fetch,
    });
  }
  return async (opts) => {
    const now = Date.now() / 1000;
    if (!(opts && opts.forceRefresh) && _fedToken && (_fedToken.expiresAt == null || _fedToken.expiresAt - now > 60)) {
      return _fedToken;
    }
    _fedToken = await _fedProvider(opts);
    return _fedToken;
  };
}

/* 인증이 틀렸을 때 — 이 함수가 실제로 어떤 신분증을 내밀고 있는지 (규칙과 대조용).
   토큰 자체는 남기지 않고 클레임만 남긴다. */
async function identityDiag() {
  const out = { runAs: '?', iss: '?', sub: '?', email: '?', aud: '?' };
  try {
    const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
      { headers: { 'Metadata-Flavor': 'Google' } });
    if (r.ok) out.runAs = (await r.text()).trim();
  } catch (e) { /* 메타데이터 없음 */ }
  try {
    const jwt = await googleIdentityToken();
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
    out.iss = p.iss; out.sub = p.sub; out.email = p.email; out.aud = p.aud;
  } catch (e) { out.tokenError = String((e && e.message) || e).slice(0, 200); }
  return out;
}

function anthropicClient() {
  if (WIF_RULE.value() && WIF_ORG.value()) return new Anthropic({ credentials: federationCredentials() });
  if (process.env.ANTHROPIC_API_KEY) return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  throw new HttpsError('failed-precondition',
    'AI 인증이 설정되지 않았어요 — 관리자: .env 에 ANTHROPIC_FEDERATION_RULE_ID·ANTHROPIC_ORGANIZATION_ID 를 넣고 다시 배포해 주세요');
}

/* 그 창고를 볼 권한이 있는지 — database.rules.json 의 warehouses 규칙과 같은 기준 */
async function canReadWarehouse(uid, wid) {
  const db = admin.database();
  const [sa, uw, ug] = await Promise.all([
    db.ref('superadmins/' + uid).once('value'),
    db.ref('userWarehouse/' + uid).once('value'),
    db.ref('userGroup/' + uid).once('value'),
  ]);
  if (sa.exists() || uw.val() === wid) return true;
  if (!ug.exists()) return false;
  return (await db.ref('groups/' + ug.val() + '/' + wid).once('value')).exists();
}

/* 창고에서 필요한 가지만 읽는다 (history 같은 큰 가지는 빼고) */
async function loadWarehouse(wid) {
  const db = admin.database(), base = 'warehouses/' + wid + '/';
  const keys = ['name', 'rows', 'cols', 'cells', 'pendOut', 'voiceOut', 'inQ'];
  const snaps = await Promise.all(keys.map((k) => db.ref(base + k).once('value')));
  const wh = {};
  keys.forEach((k, i) => { wh[k] = snaps[i].val(); });
  return wh;
}

function seoulToday() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return d.toISOString().slice(0, 10) + ' (' + days[d.getUTCDay()] + ')';
}

const ASK_SYSTEM = [
  '당신은 물류창고 관리 시스템(WMS)의 안내 도우미입니다. 현장 작업자가 폰으로 창고 재고를 묻습니다.',
  '',
  '창고 규칙:',
  '- 위치는 "열 알파벳-번호 N층" 입니다. 예: "M-3 2층" = M열 3번 유닛의 2층. 1층이 맨 아래입니다.',
  '- 한 칸(한 층)에 파렛트 하나가 들어갑니다. "팔" = 파렛트.',
  '- 유닛 종류: 랙(보통 3~4층), 보관(2층).',
  '- 작업자는 상품명을 띄어쓰기 없이 말하기도 합니다 ("서리태15" = "서리태 15"). 음성 인식이라 글자가 조금 틀릴 수 있으니, 도구가 돌려준 비슷한 이름 목록에서 가장 그럴듯한 것을 고르세요.',
  '',
  '답하는 방법:',
  '- 반드시 도구로 창고 데이터를 확인한 뒤 답하세요. 숫자를 짐작하거나 직접 세지 말고 도구 결과의 숫자를 그대로 쓰세요.',
  '- 답은 귀로 듣기 좋게 짧게: 한두 문장, 핵심 숫자와 위치를 먼저. 위치가 많으면 "E-10부터 E-16까지 1층"처럼 묶어서 말하세요. 표·마크다운·이모지는 쓰지 마세요.',
  '- 유통기한은 "27년 4월 15일"처럼 말하세요.',
  '- 입고·출고·이동 같은 변경은 할 수 없습니다. 요청받으면 화면의 작업 버튼(즉시출고·입고적치 등)을 쓰라고 안내하세요.',
  '- 데이터에 없는 것(실제로 뺐지만 기록 안 한 것 등)은 알 수 없다고 말하세요.',
].join('\n');

function askTools(idx, wh, wid) {
  let logsCache = null;
  const loadLogs = async () => {
    if (logsCache) return logsCache;
    const snap = await admin.database().ref('txLogs/' + wid).once('value');
    const v = snap.val() || {};
    logsCache = Object.keys(v).map((k) => v[k]);
    return logsCache;
  };
  const J = (x) => JSON.stringify(x);
  return [
    betaTool({
      name: 'warehouse_summary',
      description: '창고 전체 개요: 열 범위, 전체 자리 수, 채워진 파렛트 수, 빈 자리 수, 상품별 파렛트 수·총수량. 어떤 상품이 있는지 모를 때 먼저 쓰세요.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => J(T.summary(idx)),
    }),
    betaTool({
      name: 'product_stock',
      description: '한 상품의 재고: 총 파렛트·수량, 유통기한별(가장 짧은 것부터) 파렛트 수와 위치 목록. "유통기한 제일 짧은 거 어디", "몇 팔 있어" 같은 질문에.',
      inputSchema: { type: 'object', properties: { product: { type: 'string', description: '상품명 (띄어쓰기 달라도 됨)' } }, required: ['product'], additionalProperties: false },
      run: async (a) => J(T.productStock(idx, a)),
    }),
    betaTool({
      name: 'empty_positions',
      description: '빈 자리 수와 목록. column(예: "M") 이나 unit(예: "M-3") 으로 좁힐 수 있고, 둘 다 없으면 창고 전체와 열별 빈 자리 수. kind 로 랙/보관만 셀 수 있음.',
      inputSchema: { type: 'object', properties: {
        column: { type: 'string', description: '열 알파벳 한 글자, 예: M' },
        unit: { type: 'string', description: '유닛, 예: M-3' },
        kind: { type: 'string', enum: ['랙', '보관'] },
      }, additionalProperties: false },
      run: async (a) => J(T.emptyPositions(idx, a)),
    }),
    betaTool({
      name: 'location_contents',
      description: '한 유닛(예: "M-3") 또는 한 열(예: "M") 의 층별 내용: 상품·유통기한·수량 또는 비어 있음.',
      inputSchema: { type: 'object', properties: {
        unit: { type: 'string', description: '유닛, 예: M-3' },
        column: { type: 'string', description: '열 알파벳, 예: M' },
      }, additionalProperties: false },
      run: async (a) => J(T.unitContents(idx, a)),
    }),
    betaTool({
      name: 'expiring_before',
      description: '유통기한이 before 날짜(포함) 이전인 파렛트를 상품·유통기한별로. "한 달 안에 끝나는 거" 같은 질문은 오늘 날짜로 before 를 계산해서 넣으세요. product 로 한 상품만 볼 수 있음.',
      inputSchema: { type: 'object', properties: {
        before: { type: 'string', description: 'YYYY-MM-DD' },
        product: { type: 'string' },
      }, required: ['before'], additionalProperties: false },
      run: async (a) => J(T.expiring(idx, a)),
    }),
    betaTool({
      name: 'pending_lists',
      description: '지금 걸려 있는 출고대기(창고화면·음성)와 입고대기 목록.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => J(T.pendingLists(wh)),
    }),
    betaTool({
      name: 'tx_history',
      description: '입출고 일지. 기간(from~to, YYYY-MM-DD)의 입고·출고 파렛트를 날짜·상품별로. type 으로 입고(in)/출고(out)만, product 로 한 상품만.',
      inputSchema: { type: 'object', properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD (없으면 from 하루)' },
        type: { type: 'string', enum: ['in', 'out'] },
        product: { type: 'string' },
      }, required: ['from'], additionalProperties: false },
      run: async (a) => J(T.txHistory(await loadLogs(), a)),
    }),
  ];
}

exports.askWarehouse = onCall(
  {
    region: FUNC_REGION,
    memory: '512MiB',
    timeoutSeconds: 120,
    cors: true,
    /* ID 페더레이션은 "이 함수가 누구인지"로 인증한다 → 페더레이션 규칙에 등록한 그 계정으로 돌려야 한다.
       ⚠ .env 로 넘기면 배포 시점에 반영되지 않아 기본 컴퓨트 계정으로 떠서 인증이 깨진다 (실제로 그랬다).
       비밀값이 아니라 식별자라 코드에 둔다. */
    serviceAccount: process.env.ASK_SERVICE_ACCOUNT || 'wms-ai@makechango-wms.iam.gserviceaccount.com',
  },
  async (request) => {
    const t0 = Date.now();
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');
    const data = request.data || {};
    const wid = String(data.wid || '').replace(/[^A-Za-z0-9_-]/g, '');
    const question = String(data.question || '').trim().slice(0, 500);
    if (!wid || !question) throw new HttpsError('invalid-argument', '창고와 질문이 필요해요');
    if (!(await canReadWarehouse(uid, wid))) throw new HttpsError('permission-denied', '이 창고를 볼 권한이 없어요');

    const wh = await loadWarehouse(wid);
    const idx = T.buildIndex(wh);

    /* 앞선 문답 몇 개 — "그럼 M열엔?" 같은 이어지는 질문용 */
    const messages = [];
    (Array.isArray(data.history) ? data.history : []).slice(-4).forEach((h) => {
      const q = String((h && h.q) || '').slice(0, 500);
      const a = String((h && h.a) || '').slice(0, 1000);
      if (q && a) messages.push({ role: 'user', content: q }, { role: 'assistant', content: a });
    });
    messages.push({ role: 'user', content: '오늘: ' + seoulToday() + '\n창고: ' + (wh.name || wid) + '\n\n질문: ' + question });

    const client = anthropicClient();
    let final;
    try {
      final = await client.beta.messages.toolRunner({
        model: ASK_MODEL,
        max_tokens: 16000,
        max_iterations: 8,
        output_config: { effort: 'low' },          /* 조회·요약이라 깊은 사고보다 빠른 답이 낫다 */
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',                       /* 드물게 거절되면 다른 모델이 이어받는다 */
        cache_control: { type: 'ephemeral' },
        system: ASK_SYSTEM,
        tools: askTools(idx, wh, wid),
        messages,
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = String((err && err.message) || err);
      /* 인증·토큰교환 실패는 실제 내민 클레임을 함께 남긴다 (규칙의 sub/email/audience 와 대조) */
      if (err instanceof Anthropic.AuthenticationError || /401|Token exchange|authentication/i.test(msg)) {
        const d = await identityDiag();
        logger.error('Claude 인증 실패 — 페더레이션 규칙과 대조하세요', {
          message: msg.slice(0, 400), 실제서비스계정: d.runAs, 토큰_iss: d.iss, 토큰_sub: d.sub,
          토큰_email: d.email, 토큰_aud: d.aud, 토큰오류: d.tokenError || '',
          규칙: WIF_RULE.value(), 조직: WIF_ORG.value(), svac: WIF_SVAC.value(), 워크스페이스: WIF_WS.value() || '(미지정)',
        });
        throw new HttpsError('failed-precondition', 'AI 인증에 실패했어요 — 관리자에게 알려 주세요 (서버 기록에 원인 있음)');
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new HttpsError('resource-exhausted', '질문이 몰려 잠시 쉬어야 해요 — 조금 뒤 다시 물어봐 주세요');
      }
      if (err instanceof Anthropic.APIError) {
        logger.error('Claude 오류', { status: err.status, message: err.message });
        throw new HttpsError('internal', 'AI 응답 오류 (' + err.status + ')');
      }
      logger.error('askWarehouse 실패', { message: err && err.message });
      throw new HttpsError('internal', 'AI 질문 처리 실패: ' + ((err && err.message) || err));
    }

    let answer = (final.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (final.stop_reason === 'refusal') answer = '그 질문에는 답할 수 없어요.';
    if (!answer) answer = '답을 만들지 못했어요. 조금 다르게 물어봐 주세요.';
    const ms = Date.now() - t0;
    const u = final.usage || {};
    logger.info('AI 질문', { uid, wid, question, answer: answer.slice(0, 300), stop: final.stop_reason, model: final.model,
      inTok: u.input_tokens, outTok: u.output_tokens, cacheRead: u.cache_read_input_tokens, ms });
    return { ok: true, answer, ms };
  }
);

/* 테스트용 — 서버 없이 도구·프롬프트를 확인 */
exports._askInternals = { askTools, ASK_SYSTEM, seoulToday };
