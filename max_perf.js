// kilo_load.js — k6 port of kilo_load.py
//
// Требуется рядом с скриптом:
//   templates/system_prompt.txt
//   templates/tools.json
//   corpus.json            (см. generateCorpusBundle() в конце файла)
//
// Запуск:
//   k6 run \
//     --env BASE_URL=https://host/v1 --env MODEL=my-model --env API_KEY=... \
//     --env SCENARIO=soak --env SESSIONS=20 --env SOAK_DURATION_SECONDS=1800 \
//     --out json=raw.json kilo_load.js

import sse from 'k6/x/sse'
import http from 'k6/http';
import { sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

// ============================ ENV ============================
const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8000/v1').replace(/\/+$/, '');
const MODEL = __ENV.MODEL || 'default';
const API_KEY = __ENV.API_KEY || '';
const SCENARIO = __ENV.SCENARIO || 'soak';

const SESSIONS = intEnv('SESSIONS', 10);
const TARGET_CONTEXT_TOKENS = intEnv('TARGET_CONTEXT_TOKENS', 200_000);
const GROWTH_TOKENS_PER_TURN = intEnv('GROWTH_TOKENS_PER_TURN', 8_192);
const MAX_TOKENS = intEnv('MAX_TOKENS', 32_000);
const BURST_TURNS = intEnv('BURST_TURNS', 8);
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || '300s';

const SESSION_RAMP_SECONDS = floatEnv(
  'SESSION_RAMP_SECONDS',
  SCENARIO === 'burst' ? 0 : SCENARIO === 'steps' ? 120 : 60,
);
const SESSION_START_JITTER_SECONDS = floatEnv(
  'SESSION_START_JITTER_SECONDS',
  SCENARIO === 'burst' ? 1 : SCENARIO === 'steps' ? 15 : 60,
);
const STEP_DURATION_SECONDS = floatEnv('STEP_DURATION_SECONDS', 480);
const COOLDOWN_SECONDS = floatEnv('COOLDOWN_SECONDS', 60);
const BURST_DURATION_SECONDS = floatEnv('BURST_DURATION_SECONDS', 600);
const SOAK_DURATION_SECONDS = floatEnv('SOAK_DURATION_SECONDS', 3 * 3600);
const STEPS_RAW = __ENV.STEPS || '';

function intEnv(name, def) {
  const v = __ENV[name];
  return v === undefined || v === '' ? def : parseInt(v, 10);
}
function floatEnv(name, def) {
  const v = __ENV[name];
  return v === undefined || v === '' ? def : parseFloat(v);
}

// ======================= STATIC ASSETS =======================
const SYSTEM_PROMPT_TEMPLATE = open('./templates/system_prompt.txt');
const TOOLS = JSON.parse(open('./templates/tools.json'));
const CORPUS = new SharedArray('corpus', () => JSON.parse(open('./corpus.json')));

const EXPECTED_TOOL_NAMES = [
  'bash', 'read', 'glob', 'grep', 'edit', 'write', 'task',
  'webfetch', 'todowrite', 'skill', 'suggest', 'kilo_local_recall',
];
{
  const names = TOOLS.map((t) => t.function && t.function.name);
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOL_NAMES)) {
    throw new Error('Unexpected tools set: ' + JSON.stringify(names));
  }
  if (!CORPUS.length) throw new Error('Empty corpus.json');
}

// ========================= CONSTANTS =========================
const TOKEN_ESTIMATE_CHARS = 4.0;
const DEFAULT_CONTEXT_CALIBRATION = 1.15;
const DEFAULT_TOP_P = 0.95;
const KILO_USER_AGENT =
  'Kilo-Code/7.3.0 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.13';
const KILO_REFERER = 'https://kilocode.ai';
const KILO_TITLE = 'Kilo Code';
const KILO_ASSISTANT_CONTENT = '\n\n\n';

const AGENT_THINK_SECONDS = [0.05, 0.08, 0.12, 0.18, 0.27, 0.41];

// [quantile, seconds] — как в Python: лог-интерполяция
const HUMAN_PAUSE_QUANTILES = [
  [0.25, 35.5],
  [0.50, 133.9],
  [0.75, 386.4],
  [0.95, 1374.3],
];

// [weight, low, high]
const TOOL_RESULT_SIZE_BUCKETS = [
  [54.0, 1, 100],
  [28.0, 100, 500],
  [13.0, 500, 2000],
  [4.3, 2000, 8000],
  [0.1, 8000, 16000],
];

const TURN_PROMPT_TEMPLATES = [
  'Review the function shown in the tool output above, point out the exact bug or missing edge case, and rewrite it correctly.',
  'Implement the missing piece indicated by the code above: write the full function body, matching the existing style.',
  'Refactor the module shown above to remove duplication without changing its public API; show the resulting code.',
  'Explain what the code above actually does and propose a concrete fix for the most likely defect in it.',
  'Add proper error handling and type hints to the function shown above and show the corrected version.',
  'Write a unit test that reproduces the edge case exposed by the code above, then fix the code so it passes.',
];

const INITIAL_TASK =
  'Explore the codebase in the workspace, identify a non-trivial module, and implement a focused correctness fix plus a regression test. Use the available tools; do not ask follow-up questions.';

// ========================== METRICS ==========================
const ttftTrend = new Trend('kilo_ttft_seconds', true);
const e2eTrend = new Trend('kilo_e2e_seconds', true);
const genTpsTrend = new Trend('kilo_generation_tokens_per_second', true);
const promptTokensTrend = new Trend('kilo_prompt_tokens', true);
const outputTokensTrend = new Trend('kilo_output_tokens', true);
const cachedTokensTrend = new Trend('kilo_cached_tokens', true);
const errorRate = new Rate('kilo_errors');
const emptyRate = new Rate('kilo_empty_completion');
const turnsCounter = new Counter('kilo_turns');

// ========================== OPTIONS ==========================
function buildOptions() {
  const thresholds = {
    // SLO — совпадают с Python-скриптом
    'kilo_errors': ['rate<=0.01'],
    'kilo_ttft_seconds{is_entry:true}': ['p(95)<=120'],
    'kilo_ttft_seconds{is_entry:false}': ['p(95)<=30'],
    'kilo_generation_tokens_per_second': ['p(5)>=50'],
  };

  if (SCENARIO === 'burst') {
    return {
      thresholds,
      scenarios: {
        burst: {
          executor: 'constant-vus',
          vus: SESSIONS,
          duration: `${Math.ceil(BURST_DURATION_SECONDS)}s`,
          gracefulStop: '30s',
        },
      },
    };
  }
  if (SCENARIO === 'soak') {
    return {
      thresholds,
      scenarios: {
        soak: {
          executor: 'constant-vus',
          vus: SESSIONS,
          duration: `${Math.ceil(SOAK_DURATION_SECONDS)}s`,
          gracefulStop: '30s',
        },
      },
    };
  }
  // steps
  const steps = STEPS_RAW
    ? STEPS_RAW.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0)
    : geometricSeries(SESSIONS);
  const stages = [];
  for (const n of steps) {
    stages.push({ duration: `${Math.ceil(SESSION_RAMP_SECONDS)}s`, target: n });
    stages.push({
      duration: `${Math.max(1, Math.ceil(STEP_DURATION_SECONDS - SESSION_RAMP_SECONDS))}s`,
      target: n,
    });
    stages.push({ duration: `${Math.ceil(COOLDOWN_SECONDS)}s`, target: 0 });
  }
  return {
    thresholds,
    scenarios: {
      steps: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages,
        gracefulRampDown: '0s',
      },
    },
  };
}

function geometricSeries(max) {
  const out = [];
  let s = 1;
  while (s < max) { out.push(s); s *= 2; }
  out.push(max);
  return out;
}

export const options = buildOptions();

// =========================== UTILS ===========================

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function randomInt(lo, hi) {
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function pickWeighted(buckets) {
  const total = buckets.reduce((acc, b) => acc + b[0], 0);
  let r = Math.random() * total;
  for (const b of buckets) {
    r -= b[0];
    if (r <= 0) return b;
  }
  return buckets[buckets.length - 1];
}

// Канонизация JSON, аналогичная Python (sort_keys=True, separators=(",", ":"))
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

function userMessage(...texts) {
  return {
    role: 'user',
    content: texts.map((t) => ({ type: 'text', text: t })),
  };
}

function buildSystemContent(template, model, workdir, marker) {
  // Упрощённый today без tz-зависимости
  const today = new Date().toUTCString().slice(0, 16);
  return (
    template.replace(/\s+$/, '') +
    '\n\n' +
    `You are powered by the model named ${model}. The exact model ID is ${model}\n` +
    'Here is some useful information about the environment you are running in:\n' +
    '<env>\n' +
    '  Is directory a git repo: yes\n' +
    '  Platform: linux\n' +
    `  Today's date: ${today}\n` +
    `  Working directory: ${workdir}\n` +
    `  Workspace root folder: ${workdir}\n` +
    '</env>\n' +
    `<load-test-session>${marker}</load-test-session>\n`
  );
}

function environmentDetails(workdir) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, '+00:00');
  return (
    '<environment_details>\n' +
    `Current time: ${now}\n` +
    `Working directory: ${workdir}\n` +
    `Workspace root folder: ${workdir}\n` +
    '</environment_details>'
  );
}

// ======================= VU-LOCAL STATE =======================
// В k6 модульные переменные VU-локальны и переживают итерации.
let session = null;
let turn = 0;

// ====================== SESSION MANAGEMENT =====================

function createSession() {
  const vu = exec.vu.idInTest || exec.vu.idInInstance || 1;
  const marker = `load-test-session=${vu}-${uuidv4()}`;
  const affinity = `ses_${uuidv4().replace(/-/g, '')}`;
  const workdir = __ENV.WORKDIR || '/workspace';
  const system = {
    role: 'system',
    content: buildSystemContent(SYSTEM_PROMPT_TEMPLATE, MODEL, workdir, marker),
  };
  const firstUser = userMessage(
    `${INITIAL_TASK} (session=${marker})`,
    environmentDetails(workdir),
  );
  return {
    sessionId: marker,
    affinity,
    messages: [system, firstUser],
    tools: TOOLS,
    model: MODEL,
    maxTokens: MAX_TOKENS,
    corpusSlot: vu,
    turns: 0,
    // кэш оценки длины
    contextCharacters: null,
    contextMessageCount: 0,
    contextCalibration: null,
  };
}

function estimateContextTokens(sess) {
  if (sess.contextCharacters === null || sess.contextMessageCount !== sess.messages.length) {
    let chars = canonicalJson({ messages: [], tools: sess.tools, model: sess.model }).length;
    chars += Math.max(0, sess.messages.length - 1);
    for (const m of sess.messages) chars += canonicalJson(m).length;
    sess.contextCharacters = chars;
    sess.contextMessageCount = sess.messages.length;
  }
  return Math.ceil(sess.contextCharacters / TOKEN_ESTIMATE_CHARS);
}

function calibratedContextTokens(sess) {
  const est = estimateContextTokens(sess);
  const cal = sess.contextCalibration == null ? DEFAULT_CONTEXT_CALIBRATION : sess.contextCalibration;
  return Math.ceil(est * cal);
}

function appendMessages(sess, msgs) {
  estimateContextTokens(sess); // обновить кэш до добавления
  const prevCount = sess.messages.length;
  for (const m of msgs) {
    sess.messages.push(m);
    sess.contextCharacters += canonicalJson(m).length;
  }
  sess.contextCharacters += Math.max(0, sess.messages.length - 1) - Math.max(0, prevCount - 1);
  sess.contextMessageCount = sess.messages.length;
}

function calibrateContext(sess, estimate, actual) {
  if (!actual || actual <= 0 || estimate <= 0) return;
  const ratio = Math.min(2.0, Math.max(0.5, actual / estimate));
  const prev = sess.contextCalibration;
  sess.contextCalibration = prev == null ? ratio : (prev + ratio) / 2;
}

// ======================= CORPUS / TOOLS =======================

function syntheticToolResult(sess, tokens) {
  const requiredChars = Math.ceil(tokens * TOKEN_ESTIMATE_CHARS);
  const parts = [];
  let length = 0;
  let idx = (sess.corpusSlot * 1543 + sess.turns * 131) % CORPUS.length;
  let withoutContent = 0;
  while (length < requiredChars) {
    const file = CORPUS[idx];
    const content = file.content || '';
    if (content.length > 0) {
      withoutContent = 0;
      const remaining = requiredChars - length;
      const chunk =
        `<path>${file.path}</path>\n<type>file</type>\n<content>\n${content}\n</content>\n`;
      parts.push(chunk.slice(0, remaining));
      length += Math.min(chunk.length, remaining);
      if (length >= requiredChars) break;
    } else {
      withoutContent++;
      if (withoutContent === CORPUS.length) {
        throw new Error('Corpus has no non-empty text files');
      }
    }
    idx = (idx + 1) % CORPUS.length;
  }
  return parts.join('');
}

function appendToolCycle(sess, toolResultTokens, userText) {
  const callId = `call_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  const idx = (sess.corpusSlot * 1543 + sess.turns * 131) % CORPUS.length;
  const filePath = CORPUS[idx].path;
  const args = JSON.stringify({ filePath });

  appendMessages(sess, [
    {
      role: 'assistant',
      content: KILO_ASSISTANT_CONTENT,
      reasoning_content: `Inspect ${filePath} for ${sess.sessionId}.`,
      tool_calls: [
        {
          id: callId,
          type: 'function',
          function: { name: 'read', arguments: args },
        },
      ],
    },
    {
      role: 'tool',
      tool_call_id: callId,
      content: syntheticToolResult(sess, toolResultTokens),
    },
    userMessage(userText),
  ]);
}

function growHistory(sess, targetTokens, growthTokens) {
  const cur = calibratedContextTokens(sess);
  if (cur >= targetTokens) return;
  const addition = Math.min(growthTokens, targetTokens - cur);
  appendToolCycle(
    sess,
    addition,
    `Continue analysis for ${sess.sessionId}; use the previous tool result as context.`,
  );
}

function prepareSession(sess, targetTokens, growthTokens) {
  while (calibratedContextTokens(sess) < targetTokens) {
    growHistory(sess, targetTokens, growthTokens);
  }
}

// ======================= SAMPLING / PAUSES ======================

function sampleToolResultTokens() {
  const bucket = pickWeighted(TOOL_RESULT_SIZE_BUCKETS);
  return randomInt(bucket[1], bucket[2]);
}

function sampleHumanPauseSeconds() {
  const q = Math.random();
  const pts = HUMAN_PAUSE_QUANTILES;
  if (q <= pts[0][0]) {
    const [qf, vf] = pts[1];
    const [qn, vn] = pts[0];
    const slope = Math.log(vn / vf) / (qn - qf);
    return Math.exp(Math.log(vn) + slope * (q - qn));
  }
  if (q >= pts[pts.length - 1][0]) {
    const [qf, vf] = pts[pts.length - 2];
    const [qn, vn] = pts[pts.length - 1];
    const slope = Math.log(vn / vf) / (qn - qf);
    return Math.exp(Math.log(vn) + slope * (q - qn));
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ql, vl] = pts[i];
    const [qh, vh] = pts[i + 1];
    if (q >= ql && q <= qh) {
      const f = (q - ql) / (qh - ql);
      return Math.exp(Math.log(vl) + f * (Math.log(vh) - Math.log(vl)));
    }
  }
  return pts[0][1];
}

function nextPauseSeconds(turnNumber) {
  if (turnNumber % BURST_TURNS === 0) return sampleHumanPauseSeconds();
  return AGENT_THINK_SECONDS[Math.floor(Math.random() * AGENT_THINK_SECONDS.length)];
}

function turnPrompt(sess, turnNumber) {
  const tpl = TURN_PROMPT_TEMPLATES[turnNumber % TURN_PROMPT_TEMPLATES.length];
  return `${tpl} (session=${sess.sessionId}, turn=${turnNumber})`;
}

// ====================== REQUEST / HEADERS ======================

function requestPayload(sess) {
  return {
    model: sess.model,
    max_tokens: sess.maxTokens,
    top_p: DEFAULT_TOP_P,
    messages: sess.messages,
    tools: sess.tools,
    tool_choice: 'auto',
    stream: true,
    stream_options: { include_usage: true },
  };
}

function sessionHeaders(affinity) {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'User-Agent': KILO_USER_AGENT,
    'http-referer': KILO_REFERER,
    'x-title': KILO_TITLE,
    'x-session-affinity': affinity,
  };
}

// ====================== SSE PARSING ======================

function deltaText(delta) {
  let out = '';
  if (delta && typeof delta.content === 'string') out += delta.content;
  if (delta && typeof delta.reasoning_content === 'string') out += delta.reasoning_content;
  if (delta && Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      if (call && call.function && typeof call.function.arguments === 'string') {
        out += call.function.arguments;
      }
    }
  }
  return out;
}

function parseSse(body) {
  const out = {
    text: '',
    promptTokens: null,
    completionTokens: null,
    cachedTokens: null,
    malformed: false,
    done: false,
  };
  if (!body) return out;
  const lines = body.split('\n');
  for (let raw of lines) {
    raw = raw.replace(/\r$/, '');
    if (!raw.startsWith('data:')) continue;
    const payload = raw.slice(5).trim();
    if (!payload) continue;
    if (payload === '[DONE]') { out.done = true; continue; }
    let event;
    try { event = JSON.parse(payload); }
    catch (e) { out.malformed = true; continue; }
    const choices = event.choices || [];
    if (choices.length > 0) {
      out.text += deltaText(choices[0].delta || {});
    }
    const u = event.usage;
    if (u && typeof u === 'object') {
      if (typeof u.prompt_tokens === 'number') out.promptTokens = u.prompt_tokens;
      if (typeof u.completion_tokens === 'number') out.completionTokens = u.completion_tokens;
      const det = u.prompt_tokens_details;
      if (det && typeof det.cached_tokens === 'number') out.cachedTokens = det.cached_tokens;
    }
  }
  return out;
}

// ====================== ONE TURN ======================

function runTurn(sess, isEntry) {
  const url = `${BASE_URL}/chat/completions`;
  const payload = requestPayload(sess);
  const headers = sessionHeaders(sess.affinity);
  const tagEntry = isEntry ? 'true' : 'false';

  const res = http.post(url, JSON.stringify(payload), {
    headers,
    timeout: REQUEST_TIMEOUT,
    tags: { is_entry: tagEntry },
  });

  // k6 не стримит SSE: TTFB ≈ TTFT, общий E2E — duration
  const ttft = res.timings.waiting / 1000;
  const e2e = res.timings.duration / 1000;

  let parsed = { text: '', promptTokens: null, completionTokens: null, cachedTokens: null, malformed: false, done: false };
  if (res.status === 200 && res.body) {
    parsed = parseSse(res.body);
  }

  const outputTokens =
    parsed.completionTokens != null ? parsed.completionTokens
    : parsed.text.length > 0 ? Math.ceil(parsed.text.length / 4)
    : 0;

  let genTps = null;
  if (outputTokens > 0 && e2e > ttft) {
    genTps = outputTokens / (e2e - ttft);
  }

  const success =
    res.status === 200 &&
    parsed.text.length > 0 &&
    !parsed.malformed &&
    (parsed.done || outputTokens > 0);

  // metrics
  ttftTrend.add(ttft, { is_entry: tagEntry });
  e2eTrend.add(e2e);
  if (parsed.promptTokens != null) promptTokensTrend.add(parsed.promptTokens);
  if (outputTokens) outputTokensTrend.add(outputTokens);
  if (parsed.cachedTokens != null) cachedTokensTrend.add(parsed.cachedTokens);
  if (genTps != null) genTpsTrend.add(genTps);
  errorRate.add(!success);
  emptyRate.add(parsed.text.length === 0);
  turnsCounter.add(1);

  return { res, parsed, outputTokens, genTps, success };
}

// ========================== SETUP ==========================

export function setup() {
  // warm-up проверка доступности (не обязательно)
  return { startedAt: Date.now() };
}

// ========================== DEFAULT ==========================

export default function () {
  // VU-local инициализация сессии на первой итерации
  if (session === null) {
    session = createSession();

    // Начальный сдвиг старта: рамп по индексу VU + джиттер.
    // Для SCENARIO=steps рамп уже реализован через ramping-vus,
    // но небольшой джиттер не мешает.
    const vu = exec.vu.idInTest || exec.vu.idInInstance || 1;
    const spread = SESSIONS <= 1 ? 0 : ((vu - 1) * SESSION_RAMP_SECONDS) / SESSIONS;
    const jitter = Math.random() * SESSION_START_JITTER_SECONDS;
    const initialDelay = spread + jitter;
    if (initialDelay > 0) sleep(initialDelay);

    prepareSession(session, TARGET_CONTEXT_TOKENS, GROWTH_TOKENS_PER_TURN);
  }

  const estimateBefore = estimateContextTokens(session);
  const isEntry = turn === 0;
  const result = runTurn(session, isEntry);
  turn += 1;

  if (result.success) {
    calibrateContext(session, estimateBefore, result.parsed.promptTokens);
    appendMessages(session, [
      { role: 'assistant', content: result.parsed.text },
    ]);
    session.turns += 1;
    appendToolCycle(
      session,
      sampleToolResultTokens(),
      turnPrompt(session, turn),
    );
  } else {
    // ошибка: при следующем ходе снова попробуем тот же контекст
    // (сбрасывать сессию не нужно; при необходимости можно пересоздать)
  }

  const pause = nextPauseSeconds(turn);
  sleep(pause);
}

// ========================= SUMMARY ==========================

export function handleSummary(data) {
  const m = data.metrics;
  const p = (metric, key) =>
    (m[metric] && m[metric].values && m[metric].values[key] != null)
      ? m[metric].values[key]
      : null;

  const summary = {
    scenario: SCENARIO,
    model: MODEL,
    base_url: BASE_URL,
    target_context_tokens: TARGET_CONTEXT_TOKENS,
    max_tokens: MAX_TOKENS,
    sessions_requested: SESSIONS,
    ttft_entry_p95: p('kilo_ttft_seconds', 'p(95)'),
    ttft_e2e_p95: p('kilo_ttft_seconds', 'p(95)'),
    e2e_p95: p('kilo_e2e_seconds', 'p(95)'),
    gen_tps_p5: p('kilo_generation_tokens_per_second', 'p(5)'),
    gen_tps_p50: p('kilo_generation_tokens_per_second', 'p(50)'),
    errors_rate: p('kilo_errors', 'rate'),
    empty_rate: p('kilo_empty_completion', 'rate'),
    turns: p('kilo_turns', 'count'),
    thresholds: data.thresholds || {},
  };

  return {
    'stdout': JSON.stringify(summary, null, 2) + '\n',
    'kilo_summary.json': JSON.stringify(summary, null, 2) + '\n',
  };
}