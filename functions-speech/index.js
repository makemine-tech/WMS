/* ===========================================================
   WMS 음성 입출고 — 서버 음성 인식 (Google Speech-to-Text v2)

   왜 필요한가:
     브라우저 Web Speech API(webkitSpeechRecognition)는 범용 받아쓰기라
     "서리태15" / "에이 십" / "파렛트" 같은 현장 어휘를 알려줄 통로가 없다.
     (표준의 SpeechGrammarList 는 크롬이 무시한다.)
     STT v2 는 inline PhraseSet 으로 어휘를 boost 할 수 있어서,
     그 창고에 실제로 등록된 상품명을 우선적으로 듣도록 디코딩이 바뀐다.

   호출: firebase.app().functions('asia-southeast1').httpsCallable('sttVoice')
     입력  { audio: base64, mime: 'audio/webm;codecs=opus', phrases: ['서리태15', ...] }
     출력  { ok, alts: [문장…], adapted: bool, model: 'short', ms }

   인증 필수. 오디오는 저장하지 않고 메모리에서 인식 후 버린다.
=========================================================== */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { SpeechClient } = require('@google-cloud/speech').v2;

if (!admin.apps.length) admin.initializeApp();

const FUNC_REGION = 'asia-southeast1';
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
/* 어휘 부스트(model adaptation)는 global 엔드포인트의 short/long 모델에서 동작한다 */
const STT_LOCATION = 'global';
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;   /* 약 20초 분량의 opus — 명령 한 마디로 충분 */
const MAX_PHRASES = 700;                    /* inline PhraseSet 한도 — 24열x21행(504) 조합이 들어갈 만큼 */

let _client = null;
function client() {
  if (!_client) _client = new SpeechClient();   /* ADC — 같은 프로젝트 서비스 계정, API 키 없음 */
  return _client;
}

/* ─── 질문별 어휘 만들기 ───
   문답형에서는 지금 무엇을 묻는지 알기 때문에, 그 종류의 말만 올린다.
   후보가 좁을수록 오인식이 준다. boost 는 20 을 넘기면 없는 말을 지어내므로 올리지 않는다. */
const LETTER_SAY = {A:'에이',B:'비',C:'씨',D:'디',E:'이',F:'에프',G:'지',H:'에이치',I:'아이',J:'제이',
  K:'케이',L:'엘',M:'엠',N:'엔',O:'오',P:'피',Q:'큐',R:'알',S:'에스',T:'티',U:'유',V:'브이',
  W:'더블유',X:'엑스',Y:'와이',Z:'제트'};
const SINO = ['영','공','일','이','삼','사','오','육','칠','팔','구','십','백'];
const NATIVE = ['하나','둘','셋','넷','다섯','여섯','일곱','여덟','아홉','열','스물','서른','마흔','쉰'];
const YESNO = ['네','예','맞아요','아니오','아니요','아뇨','취소'];
const DIG = ['영','일','이','삼','사','오','육','칠','팔','구'];

/* 유통기한은 한 자리씩 읽는다 — 270703 -> 이칠공칠공삼 */
function readDigits(v) {
  return String(v || '').split('').map((c) => (c === '0' ? '공' : (DIG[+c] || c))).join('');
}
/* 수량은 자릿수로 읽는다 — 125 -> 백이십오 */
function readSino(n) {
  let x = Math.floor(Math.abs(+n)) || 0, s = '';
  [[1000, '천'], [100, '백'], [10, '십']].forEach((u) => {
    const d = Math.floor(x / u[0]);
    if (d) { s += (d > 1 ? DIG[d] : '') + u[1]; x -= d * u[0]; }
  });
  if (x) s += DIG[x];
  return s || '영';
}

function buildPhrases(slot, products, cols, priority, rows, levels) {
  const seen = new Set();
  const out = [];
  const add = (value, boost) => {
    const v = String(value || '').trim().slice(0, 100);
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ value: v, boost });
  };
  const prods = Array.isArray(products) ? products : [];
  const colList = (Array.isArray(cols) && cols.length) ? cols : Object.keys(LETTER_SAY);
  /* 예정작업에 적어 둔 것 — 오늘 실제로 들어오고 나갈 것부터 알아듣게 최우선으로 올린다 */
  const pr = priority || {};
  const pProds = Array.isArray(pr.products) ? pr.products : [];
  const pExps = Array.isArray(pr.exps) ? pr.exps : [];
  const pNums = Array.isArray(pr.nums) ? pr.nums : [];

  switch (slot) {
    case 'product':
      pProds.forEach((p) => add(p, 20));
      /* 예정에 없는 상품은 낮게 — 후보를 오늘 것 쪽으로 기울인다 */
      prods.slice(0, MAX_PHRASES).forEach((p) => add(p, pProds.length ? 10 : 20));
      break;
    case 'unit': {
      /* 이 창고에 실제로 있는 열만 — 없는 열은 아예 후보에서 뺀다 */
      const nRows = Math.min(Math.max(+rows || 0, 0), 99);
      const says = colList.map((c) => LETTER_SAY[String(c).toUpperCase()] || String(c).toUpperCase());
      /* 열 x 번호 조합이 감당할 만하면 "에이 십이" 처럼 통째로 올린다 — 가장 잘 듣는다 */
      if (nRows && says.length * nRows <= MAX_PHRASES - says.length * 2) {
        says.forEach((sy) => { for (let r = 1; r <= nRows; r++) add(sy + ' ' + readSino(r), 20); });
      }
      colList.forEach((c) => {
        const u = String(c).toUpperCase();
        add(LETTER_SAY[u] || u, 18);
        add(u, 18);
      });
      for (let r = 1; r <= nRows; r++) add(readSino(r), 14);   /* "십이" 처럼 두 자리는 특히 도움이 된다 */
      SINO.forEach((n) => add(n, 8));
      break;
    }
    case 'lvl': {
      /* 낱글자 "삼" 을 올려도 "삼층" 인식에는 거의 도움이 안 된다.
         실제로 말하는 모양 그대로 올린다. */
      const top = Math.min(Math.max(+levels || 4, 1), 9);
      for (let i = 1; i <= top; i++) {
        add(readSino(i) + '층', 20);
        add(i + '층', 20);
        add(readSino(i), 12);
      }
      SINO.forEach((n) => add(n, 8));
      break;
    }
    case 'num':
      pNums.forEach((v) => { add(String(v), 18); add(readSino(v), 18); });
      SINO.forEach((n) => add(n, 15));
      NATIVE.forEach((n) => add(n, 15));
      break;
    case 'exp':
      pExps.forEach((e) => { add(String(e), 18); add(readDigits(e), 18); });
      SINO.forEach((n) => add(n, 15));
      ['년', '월', '일'].forEach((n) => add(n, 10));
      break;
    case 'yesno':
      YESNO.forEach((n) => add(n, 18));
      break;
    default:
      pProds.forEach((p) => add(p, 20));
      prods.slice(0, 300).forEach((p) => add(p, pProds.length ? 10 : 20));
      colList.forEach((c) => add(LETTER_SAY[String(c).toUpperCase()] || String(c), 12));
      SINO.forEach((n) => add(n, 8));
  }
  return out.slice(0, MAX_PHRASES);
}


function recognizeConfig(phrases) {
  const config = {
    autoDecodingConfig: {},        /* webm/opus 를 헤더에서 알아서 판별 — v2 의 장점 */
    languageCodes: ['ko-KR'],
    model: 'short',                /* 짧은 명령어에 최적화된 모델 */
    features: { maxAlternatives: 5 },
  };
  if (phrases.length) {
    config.adaptation = { phraseSets: [{ inlinePhraseSet: { phrases } }] };
  }
  return config;
}

function altsFrom(response) {
  const alts = [];
  (response.results || []).forEach((r) => {
    (r.alternatives || []).forEach((a, i) => {
      const t = String(a.transcript || '').trim();
      if (!t) return;
      if (!alts[i]) alts[i] = '';
      alts[i] = (alts[i] ? alts[i] + ' ' : '') + t;
    });
  });
  return alts.filter(Boolean);
}

exports.sttVoice = onCall(
  {
    region: FUNC_REGION,
    memory: '512MiB',
    timeoutSeconds: 60,
    cors: true,
  },
  async (request) => {
    const t0 = Date.now();
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해요');

    const data = request.data || {};
    const b64 = typeof data.audio === 'string' ? data.audio : '';
    if (!b64) throw new HttpsError('invalid-argument', '오디오가 비어 있어요');

    let audio;
    try {
      audio = Buffer.from(b64, 'base64');
    } catch (e) {
      throw new HttpsError('invalid-argument', '오디오 형식이 올바르지 않아요');
    }
    if (!audio.length) throw new HttpsError('invalid-argument', '오디오가 비어 있어요');
    if (audio.length > MAX_AUDIO_BYTES) {
      throw new HttpsError('invalid-argument', '녹음이 너무 길어요 — 한 문장씩 말씀해 주세요');
    }

    const phrases = buildPhrases(data.slot, data.products, data.cols, data.priority, data.rows, data.levels);
    const recognizer = `projects/${PROJECT_ID}/locations/${STT_LOCATION}/recognizers/_`;

    /* 1차: 어휘 부스트 켜고 시도.
       모델·언어 조합에 따라 adaptation 이 거부될 수 있으므로, 그때는 끄고 한 번 더. */
    let response;
    let adapted = phrases.length > 0;
    try {
      [response] = await client().recognize({
        recognizer,
        config: recognizeConfig(phrases),
        content: audio,
      });
    } catch (err) {
      const code = err && err.code;
      const retryable = adapted && (code === 3 || code === 9);   /* INVALID_ARGUMENT / FAILED_PRECONDITION */
      if (!retryable) {
        logger.error('STT 실패', { uid, code, message: err && err.message });
        if (code === 7) {
          throw new HttpsError('permission-denied',
            'Speech-to-Text 권한이 없어요 — 서비스 계정에 speech.client 역할이 필요해요');
        }
        throw new HttpsError('internal', '음성 인식에 실패했어요: ' + ((err && err.message) || err));
      }
      logger.warn('어휘 부스트 미지원 — 부스트 없이 재시도', { code, message: err && err.message });
      adapted = false;
      [response] = await client().recognize({
        recognizer,
        config: recognizeConfig([]),
        content: audio,
      });
    }

    const alts = altsFrom(response);
    const ms = Date.now() - t0;
    logger.info('STT 완료', { uid, slot: data.slot || '-', adapted, phrases: phrases.length, bytes: audio.length, alts: alts.length, ms });
    return { ok: true, alts, adapted, model: 'short', ms };
  }
);
