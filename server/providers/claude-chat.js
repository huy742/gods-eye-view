import Anthropic from '@anthropic-ai/sdk';
import { realtimeInstructions } from './openai/instructions.js';
import { GEV_REALTIME_TOOLS } from './openai/tools.js';

/**
 * Vite plugin: Claude chat panel (typed and spoken) for God's Eye View.
 *
 * - GET  /api/claude/status reports the model, effort and output cap the proxy
 *   will use. It never returns the key.
 * - POST /api/claude/chat forwards a conversation to the Anthropic Messages API.
 *   ANTHROPIC_API_KEY stays on the server.
 * - A `transform` hook patches src/voice/gevRealtime.js in memory (the file on
 *   disk is untouched) so the action runner built for the OpenAI voice agent is
 *   shared with the chat panel. Claude sees the same 30 tools.
 *
 * The browser half lives in `claudeChatClient`. It is serialized into a virtual
 * module with Function#toString, so it must not reference anything outside its
 * own body.
 */

const CLAUDE_MODEL_DEFAULT = 'claude-sonnet-5-5';
// Thinking tokens count toward max_tokens.
const MAX_OUTPUT_TOKENS = 16000;
const CLAUDE_EFFORT_DEFAULT = 'medium';
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Server-side refusal fallback. The "default" form is documented for
// claude-sonnet-5-5 on the Claude API; other models are sent without it.
const CLAUDE_FALLBACK_MODELS = new Set(['claude-sonnet-5-5']);
const CLAUDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const CLAUDE_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

// Appended to user turns that came from the microphone. It rides in the user
// message, never in `system`, so the cached tools+system prefix stays identical.
const VOICE_TURN_NOTE =
  '[Tin này đến từ giọng nói: trả lời ngắn 1–2 câu, không dùng markdown, không đọc JSON]';

const CLAUDE_SYSTEM_PROMPT = [
  "You are Claude, the assistant inside God's Eye View, a Cesium 3D globe app. The user talks to you in a chat panel, by typing or by voice.",
  'Reply in the language the user writes in (usually Vietnamese or English).',
  'You control the app only through the provided tools. The guidance below was written for the app\'s realtime voice agent and applies to you too: where it says "speak" or "say", it means your reply.',
  'Typed messages may get short plain-text replies. A user message that ends with a note saying it came from voice gets one or two short sentences, with no markdown and no JSON.',
  '',
  realtimeInstructions(),
].join('\n');

const CLAUDE_TOOLS = GEV_REALTIME_TOOLS.map(
  ({ name, description, parameters }) => ({
    name,
    description,
    input_schema: parameters,
  }),
);

const VIRTUAL_ID = 'virtual:gev-claude-chat';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;
const RUNNER_SITE = 'runner: createGevActionRunner(options),';
const SHARED_RUNNER_SITE =
  'runner: __gevClaudeShareRunner(createGevActionRunner(options)),';

let warnedEffort = '';

/** Read the model settings from the environment at request time. */
function resolveClaudeConfig(env = process.env) {
  const model =
    String(env.ANTHROPIC_MODEL || '').trim() || CLAUDE_MODEL_DEFAULT;
  const tokens = Number(String(env.ANTHROPIC_MAX_TOKENS || '').trim());
  const maxTokens =
    Number.isInteger(tokens) && tokens > 0 ? tokens : MAX_OUTPUT_TOKENS;
  const requested = String(env.ANTHROPIC_EFFORT || '')
    .trim()
    .toLowerCase();
  if (requested && !CLAUDE_EFFORTS.includes(requested)) {
    if (warnedEffort !== requested)
      console.warn(
        `[claude-chat] ANTHROPIC_EFFORT=${requested} is not one of ${CLAUDE_EFFORTS.join('|')}; using ${CLAUDE_EFFORT_DEFAULT}`,
      );
    warnedEffort = requested;
  }
  const effort = model.toLowerCase().includes('haiku')
    ? null
    : CLAUDE_EFFORTS.includes(requested)
      ? requested
      : CLAUDE_EFFORT_DEFAULT;
  const fallbacks =
    CLAUDE_FALLBACK_MODELS.has(model) &&
    !/^(0|false|off|no)$/i.test(String(env.ANTHROPIC_FALLBACKS || '').trim());
  return { model, maxTokens, effort, fallbacks };
}

/** Validate browser history and apply the voice note to spoken user turns. */
function prepareClaudeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0)
    throw new TypeError('messages must be a non-empty array');
  return messages.map((message) => {
    const { role, content, voice } = message || {};
    if (role !== 'user' && role !== 'assistant')
      throw new TypeError('Only user and assistant messages are accepted');
    if (typeof content !== 'string' && !Array.isArray(content))
      throw new TypeError('Message content must be text or content blocks');
    if (role !== 'user' || voice !== true) return { role, content };
    const blocks =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    return {
      role,
      content: [...blocks, { type: 'text', text: VOICE_TURN_NOTE }],
    };
  });
}

/** Build the Messages API request. Tools and system never vary per request. */
function buildClaudeRequest(messages, config) {
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    system: [
      {
        type: 'text',
        text: CLAUDE_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: CLAUDE_TOOLS,
    messages: prepareClaudeMessages(messages),
    // Caches the growing conversation as well as the fixed prefix.
    cache_control: { type: 'ephemeral' },
    ...(config.effort ? { output_config: { effort: config.effort } } : {}),
    ...(config.fallbacks
      ? { betas: [CLAUDE_FALLBACK_BETA], fallbacks: 'default' }
      : {}),
  };
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// A JSON content type forces a CORS preflight that this server never answers,
// and Sec-Fetch-Site/Origin catch the rest, so another site cannot spend the
// key through a visitor's browser.
function isCrossSiteRequest(req) {
  const site = String(req.headers['sec-fetch-site'] || '');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}

function createClaudeStatusHandler({ env = process.env } = {}) {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    const { model, maxTokens, effort, fallbacks } = resolveClaudeConfig(env);
    sendJson(res, 200, {
      configured: Boolean(env.ANTHROPIC_API_KEY),
      model,
      maxTokens,
      effort,
      fallbacks,
    });
  };
}

function createClaudeChatHandler({
  env = process.env,
  baseURL,
  createClient = (options) => new Anthropic(options),
} = {}) {
  let client = null;
  let clientKey = '';
  const clientFor = (apiKey) => {
    if (!client || clientKey !== apiKey) {
      client = createClient({ apiKey, ...(baseURL ? { baseURL } : {}) });
      clientKey = apiKey;
    }
    return client;
  };

  return async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    if (isCrossSiteRequest(req)) {
      sendJson(res, 403, { error: 'Cross-site requests are not allowed' });
      return;
    }
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      sendJson(res, 415, { error: 'Content-Type must be application/json' });
      return;
    }
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      sendJson(res, 503, { error: 'ANTHROPIC_API_KEY is not set' });
      return;
    }

    let params;
    try {
      const body = JSON.parse(
        await readRequestBody(req, CLAUDE_REQUEST_MAX_BYTES),
      );
      params = buildClaudeRequest(body?.messages, resolveClaudeConfig(env));
    } catch (error) {
      sendJson(res, error.status || 400, {
        error:
          error instanceof SyntaxError ? 'Invalid JSON body' : error.message,
      });
      return;
    }

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    try {
      // Streamed upstream so a large max_tokens cannot hit the SDK's
      // non-streaming timeout; the browser still gets one complete message.
      const message = await clientFor(apiKey)
        .beta.messages.stream(params, { signal: abort.signal })
        .finalMessage();
      sendJson(res, 200, message);
    } catch (error) {
      if (abort.signal.aborted) return;
      if (error instanceof Anthropic.APIError && error.status) {
        sendJson(res, error.status, {
          error: error.error?.error?.message || error.message,
          type: error.error?.error?.type,
        });
        return;
      }
      console.warn('[claude-chat] Anthropic request failed');
      sendJson(res, 502, { error: 'Could not reach the Anthropic API' });
    }
  };
}

/** Share the runner built in gevRealtime.js with the chat panel. */
function patchGevRealtime(code) {
  const header = `import { shareRunner as __gevClaudeShareRunner } from '${VIRTUAL_ID}';\n`;
  if (code.includes(RUNNER_SITE))
    return header + code.replace(RUNNER_SITE, SHARED_RUNNER_SITE);
  // Mount the panel anyway: chat keeps working, only the map tools are missing.
  return `${header}${code}\n__gevClaudeShareRunner(null);\n`;
}

function claudeChatModuleSource() {
  return [
    `const createClaudeChat = ${claudeChatClient.toString()};`,
    'const chat = createClaudeChat(globalThis);',
    'export const shareRunner = chat.shareRunner;',
    '',
  ].join('\n');
}

function claudeChatPlugin(options = {}) {
  const install = (server) => {
    server.middlewares.use(
      '/api/claude/status',
      createClaudeStatusHandler(options),
    );
    server.middlewares.use(
      '/api/claude/chat',
      createClaudeChatHandler(options),
    );
  };
  return {
    name: 'gev-claude-chat',
    configureServer: install,
    configurePreviewServer: install,
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null;
    },
    load(id) {
      return id === RESOLVED_VIRTUAL_ID ? claudeChatModuleSource() : null;
    },
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/');
      if (!file.endsWith('/src/voice/gevRealtime.js')) return null;
      if (!code.includes(RUNNER_SITE))
        this.warn(
          'gevRealtime.js changed shape; the Claude chat panel runs without map tools',
        );
      return { code: patchGevRealtime(code), map: null };
    },
  };
}

/**
 * Browser half: chat panel, microphone (SpeechRecognition) and read-aloud
 * (speechSynthesis). Self-contained on purpose; see the file header.
 */
function claudeChatClient(win) {
  const doc = win.document;
  const STORAGE_PREFIX = 'gev.claudeChat.';
  const MAX_TOOL_ROUNDS = 10;
  const MAX_TOOL_RESULT_CHARS = 60000;
  // US$ per million tokens.
  const PRICES = {
    'claude-sonnet-5-5': {
      input: 2,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.2,
    },
  };
  const LANGS = [
    ['vi-VN', 'Tiếng Việt'],
    ['en-US', 'English'],
  ];
  const CSS = `
#gev-claude-chat{position:fixed;left:16px;bottom:16px;z-index:1200;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e6edf3}
#gev-claude-chat button,#gev-claude-chat select,#gev-claude-chat textarea{font:inherit;color:inherit}
.gev-claude-toggle{background:#1b2230e6;border:1px solid #3b4a63;border-radius:18px;padding:6px 14px;cursor:pointer}
.gev-claude-toggle[aria-expanded="true"]{display:none}
.gev-claude-panel{width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;background:#10151ef2;border:1px solid #3b4a63;border-radius:10px;box-shadow:0 8px 28px #0008;overflow:hidden}
.gev-claude-panel[hidden]{display:none}
.gev-claude-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #263041}
.gev-claude-title{font-weight:600}
.gev-claude-model{flex:1;opacity:.65;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gev-claude-head button{background:none;border:1px solid transparent;border-radius:6px;padding:2px 8px;cursor:pointer}
.gev-claude-head button:hover{border-color:#3b4a63}
.gev-claude-log{flex:1;min-height:120px;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.gev-claude-msg{white-space:pre-wrap;word-break:break-word;padding:6px 9px;border-radius:8px;max-width:92%}
.gev-claude-msg.user{align-self:flex-end;background:#244a7a}
.gev-claude-msg.assistant{align-self:flex-start;background:#1f2937}
.gev-claude-msg.tool{align-self:flex-start;font:11px/1.35 ui-monospace,monospace;opacity:.75;padding:2px 4px}
.gev-claude-msg.system{align-self:center;font-size:12px;color:#f5c26b;text-align:center}
.gev-claude-interim{padding:0 10px 6px;font-style:italic;opacity:.8}
.gev-claude-note{padding:0 10px 6px;font-size:12px;color:#f5c26b}
.gev-claude-usage{padding:4px 10px;font-size:11px;opacity:.7;border-top:1px solid #263041}
.gev-claude-interim:empty,.gev-claude-note:empty,.gev-claude-usage:empty{display:none}
.gev-claude-form{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-top:1px solid #263041}
.gev-claude-input{resize:vertical;min-height:38px;max-height:160px;background:#0b0f16;border:1px solid #3b4a63;border-radius:6px;padding:6px 8px}
.gev-claude-controls{display:flex;gap:6px;align-items:center}
.gev-claude-controls button,.gev-claude-controls select{background:#1b2230;border:1px solid #3b4a63;border-radius:6px;padding:4px 8px;cursor:pointer}
.gev-claude-controls button[aria-pressed="true"]{background:#244a7a;border-color:#5b8bd0}
.gev-claude-controls button[hidden]{display:none}
.gev-claude-controls button:disabled{opacity:.45;cursor:default}
.gev-claude-mic[data-listening="true"]{background:#7a2430;border-color:#d05b6b}
.gev-claude-send{margin-left:auto}
`;

  const state = {
    runner: null,
    history: [],
    model: null,
    busy: false,
    abort: null,
    listening: false,
    recognition: null,
    speak: readPref('speak', '0') === '1',
    lang: LANGS.some(([code]) => code === readPref('lang', ''))
      ? readPref('lang', '')
      : 'vi-VN',
    speechToken: 0,
    sessionCost: 0,
    sessionPriced: true,
  };
  const notes = { support: [], tools: '', voice: '' };
  let ui = null;

  function readPref(key, fallback) {
    try {
      const value = win.localStorage?.getItem(STORAGE_PREFIX + key);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writePref(key, value) {
    try {
      win.localStorage?.setItem(STORAGE_PREFIX + key, value);
    } catch {
      // Preferences are a convenience; private windows may refuse them.
    }
  }

  function el(tag, attrs = {}, children = []) {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children) node.append(child);
    return node;
  }

  function recognitionClass() {
    return win.SpeechRecognition || win.webkitSpeechRecognition || null;
  }

  function hasSpeechSynthesis() {
    return Boolean(win.speechSynthesis && win.SpeechSynthesisUtterance);
  }

  function langLabel(code) {
    return (LANGS.find(([value]) => value === code) || [code, code])[1];
  }

  function mount() {
    if (ui) return ui;
    if (!doc.body) {
      doc.addEventListener('DOMContentLoaded', mount, { once: true });
      return null;
    }
    doc.getElementById('gev-claude-chat')?.remove();
    doc.getElementById('gev-claude-chat-style')?.remove();
    const style = el('style', { id: 'gev-claude-chat-style' });
    style.textContent = CSS;
    (doc.head || doc.body).append(style);

    const toggle = el('button', {
      type: 'button',
      class: 'gev-claude-toggle',
      'aria-expanded': 'false',
      'aria-controls': 'gev-claude-panel',
      text: 'Claude',
    });
    const model = el('span', { class: 'gev-claude-model' });
    const clear = el('button', {
      type: 'button',
      class: 'gev-claude-clear',
      title: 'Xoá lịch sử hội thoại',
      text: 'Xoá',
    });
    const close = el('button', {
      type: 'button',
      class: 'gev-claude-close',
      'aria-label': 'Đóng khung chat',
      text: '×',
    });
    const log = el('div', {
      class: 'gev-claude-log',
      role: 'log',
      'aria-live': 'polite',
    });
    const interim = el('div', {
      class: 'gev-claude-interim',
      'aria-live': 'polite',
    });
    const note = el('div', { class: 'gev-claude-note', role: 'status' });
    const usage = el('div', { class: 'gev-claude-usage' });
    const input = el('textarea', {
      class: 'gev-claude-input',
      rows: 2,
      'aria-label': 'Tin nhắn cho Claude',
      placeholder: 'Nhắn cho Claude… (Enter để gửi, Shift+Enter xuống dòng)',
    });
    const mic = el('button', {
      type: 'button',
      class: 'gev-claude-mic',
      'aria-pressed': 'false',
      title: 'Bấm để nói; bấm lần nữa hoặc im lặng để gửi',
      text: '🎤 Nói',
    });
    const lang = el(
      'select',
      { class: 'gev-claude-lang', 'aria-label': 'Ngôn ngữ giọng nói' },
      LANGS.map(([value, label]) => el('option', { value, text: label })),
    );
    lang.value = state.lang;
    const speak = el('button', {
      type: 'button',
      class: 'gev-claude-speak',
      'aria-pressed': String(state.speak),
      title: 'Bật/tắt đọc câu trả lời',
      text: '🔈 Đọc',
    });
    const sendButton = el('button', {
      type: 'submit',
      class: 'gev-claude-send',
      text: 'Gửi',
    });
    const form = el('form', { class: 'gev-claude-form' }, [
      input,
      el('div', { class: 'gev-claude-controls' }, [
        mic,
        lang,
        speak,
        sendButton,
      ]),
    ]);
    const panel = el(
      'section',
      {
        id: 'gev-claude-panel',
        class: 'gev-claude-panel',
        'aria-label': 'Chat với Claude',
        hidden: true,
      },
      [
        el('div', { class: 'gev-claude-head' }, [
          el('span', { class: 'gev-claude-title', text: 'Claude' }),
          model,
          clear,
          close,
        ]),
        log,
        interim,
        note,
        usage,
        form,
      ],
    );
    const root = el('div', { id: 'gev-claude-chat' }, [toggle, panel]);
    ui = {
      root,
      toggle,
      panel,
      model,
      clear,
      close,
      log,
      interim,
      note,
      usage,
      form,
      input,
      mic,
      lang,
      speak,
      send: sendButton,
    };

    toggle.addEventListener('click', () => setOpen(true));
    close.addEventListener('click', () => setOpen(false));
    clear.addEventListener('click', clearHistory);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submit();
    });
    mic.addEventListener('click', toggleMic);
    speak.addEventListener('click', toggleSpeak);
    lang.addEventListener('change', () => {
      state.lang = lang.value;
      writePref('lang', state.lang);
      if (state.speak) checkVoice();
    });
    // Capture on window runs before the app's document-level shortcuts
    // (hold-Space push-to-talk among them), so typing here never reaches them.
    for (const type of ['keydown', 'keyup', 'keypress'])
      win.addEventListener(type, onKey, true);

    if (!recognitionClass()) {
      mic.hidden = true;
      notes.support.push(
        'Trình duyệt này không có nhận giọng nói (Web Speech API), ví dụ Firefox, nên nút mic bị ẩn. Dùng Chrome hoặc Edge để nói; gõ chữ vẫn dùng được.',
      );
    }
    if (!hasSpeechSynthesis()) {
      speak.hidden = true;
      notes.support.push(
        'Trình duyệt này không có speechSynthesis nên không đọc được câu trả lời.',
      );
    }
    doc.body.append(root);
    renderNote();
    return ui;
  }

  function renderNote() {
    if (!ui) return;
    ui.note.textContent = [...notes.support, notes.tools, notes.voice]
      .filter(Boolean)
      .join('\n');
  }

  function setOpen(open) {
    if (!mount()) return;
    ui.panel.hidden = !open;
    ui.toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      ui.input.focus();
      refreshStatus();
    } else {
      ui.toggle.focus();
    }
  }

  async function refreshStatus() {
    try {
      const status = await fetchStatus();
      ui.model.textContent = status.configured
        ? status.model
        : 'chưa có ANTHROPIC_API_KEY';
    } catch {
      ui.model.textContent = 'không kết nối được server';
    }
  }

  function onKey(event) {
    if (!ui || !(event.target instanceof win.Node)) return;
    if (!ui.root.contains(event.target)) return;
    event.stopPropagation();
    if (event.type !== 'keydown') return;
    if (
      event.target === ui.input &&
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      // Enter never doubles as the Stop button while a reply is pending.
      if (!state.busy) submit();
    } else if (event.key === 'Escape' && !state.listening) {
      event.preventDefault();
      setOpen(false);
    }
  }

  function addLine(kind, text) {
    const line = el('div', { class: `gev-claude-msg ${kind}`, text });
    ui.log.append(line);
    ui.log.scrollTop = ui.log.scrollHeight;
    return line;
  }

  function setBusy(busy) {
    state.busy = busy;
    if (!ui) return;
    ui.send.textContent = busy ? 'Dừng' : 'Gửi';
    ui.mic.disabled = busy;
    ui.clear.disabled = busy;
  }

  function clearHistory() {
    if (state.busy) return;
    state.history = [];
    ui.log.replaceChildren();
    addLine('system', 'Đã xoá lịch sử hội thoại.');
  }

  function submit() {
    if (state.busy) {
      state.abort?.abort();
      return;
    }
    const text = ui.input.value.trim();
    if (!text) return;
    ui.input.value = '';
    send(text);
  }

  async function fetchStatus(signal) {
    const response = await win.fetch('/api/claude/status', {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      throw new Error(`/api/claude/status trả về HTTP ${response.status}`);
    return response.json();
  }

  async function postChat(messages, signal) {
    const response = await win.fetch('/api/claude/chat', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok)
      throw new Error(
        data?.error
          ? `${data.error} (HTTP ${response.status})`
          : `HTTP ${response.status}`,
      );
    if (!data || !Array.isArray(data.content))
      throw new Error('Phản hồi không hợp lệ từ /api/claude/chat');
    return data;
  }

  function toolResultText(result) {
    let text;
    try {
      text = JSON.stringify(result === undefined ? null : result);
    } catch {
      text = JSON.stringify({ ok: false, error: 'Tool result is not JSON' });
    }
    return text.length > MAX_TOOL_RESULT_CHARS
      ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)} …[truncated]`
      : text;
  }

  async function runTool(block, signal) {
    let args = '';
    try {
      args = JSON.stringify(block.input || {});
    } catch {
      args = '';
    }
    const line = addLine(
      'tool',
      `⚙ ${block.name} ${args.length > 140 ? `${args.slice(0, 140)}…` : args}`,
    );
    let result;
    let isError = false;
    if (typeof state.runner !== 'function') {
      result = { ok: false, error: 'App tools are not available on this page' };
      isError = true;
    } else {
      try {
        result = await state.runner(block.name, block.input || {}, { signal });
      } catch (error) {
        result = { ok: false, error: String(error?.message || error) };
        isError = true;
      }
    }
    line.textContent += result?.ok === false ? ' → lỗi' : ' → xong';
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: toolResultText(result),
      ...(isError ? { is_error: true } : {}),
    };
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString('en-US');
  }

  function showUsage(usage, priced, cost) {
    const parts = [
      `Token: vào ${formatCount(usage.input)} · ra ${formatCount(usage.output)} · cache ghi ${formatCount(usage.cacheWrite)} · cache đọc ${formatCount(usage.cacheRead)}`,
    ];
    if (priced) {
      parts.push(
        `≈ $${cost.toFixed(4)} tin này` +
          (state.sessionPriced
            ? ` · ≈ $${state.sessionCost.toFixed(4)} cả phiên`
            : ''),
      );
    } else {
      parts.push('chưa có bảng giá cho model này');
    }
    ui.usage.textContent = parts.join(' · ');
  }

  async function send(rawText, { voice = false } = {}) {
    const text = String(rawText == null ? '' : rawText).trim();
    if (!text || state.busy || !mount()) return false;
    setBusy(true);
    const controller = new win.AbortController();
    state.abort = controller;
    const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let cost = 0;
    let priced = true;
    let requests = 0;
    let checkpoint = state.history.length;
    try {
      const status = await fetchStatus(controller.signal);
      if (!status.configured) {
        addLine(
          'system',
          'Server chưa có ANTHROPIC_API_KEY. Thêm key vào .env rồi khởi động lại npm run dev.',
        );
        return false;
      }
      // Thinking blocks are bound to the model that wrote them.
      if (state.model && status.model !== state.model && state.history.length) {
        state.history = [];
        addLine(
          'system',
          `Model đổi từ ${state.model} sang ${status.model}: đã xoá lịch sử hội thoại.`,
        );
      }
      state.model = status.model;
      ui.model.textContent = status.model;
      checkpoint = state.history.length;

      addLine('user', voice ? `🎤 ${text}` : text);
      state.history.push(
        voice
          ? { role: 'user', content: text, voice: true }
          : { role: 'user', content: text },
      );
      let finalText = '';
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const message = await postChat(state.history, controller.signal);
        requests++;
        const used = message.usage || {};
        const turnUsage = {
          input: used.input_tokens || 0,
          output: used.output_tokens || 0,
          cacheWrite: used.cache_creation_input_tokens || 0,
          cacheRead: used.cache_read_input_tokens || 0,
        };
        for (const key of Object.keys(usage)) usage[key] += turnUsage[key];
        const price = PRICES[message.model] || PRICES[status.model];
        if (price) {
          cost +=
            (turnUsage.input * price.input +
              turnUsage.output * price.output +
              turnUsage.cacheWrite * price.cacheWrite +
              turnUsage.cacheRead * price.cacheRead) /
            1e6;
        } else {
          priced = false;
        }

        if (message.stop_reason === 'refusal') {
          state.history.length = checkpoint;
          const category = message.stop_details?.category;
          addLine(
            'system',
            `Claude từ chối yêu cầu này${category ? ` (${category})` : ''}. Tin này không được lưu vào lịch sử.`,
          );
          finalText = '';
          break;
        }
        state.history.push({ role: 'assistant', content: message.content });
        const replyText = message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim();
        if (replyText) {
          addLine('assistant', replyText);
          finalText = replyText;
        }
        if (message.stop_reason !== 'tool_use') {
          if (message.stop_reason === 'max_tokens')
            addLine('system', 'Câu trả lời bị cắt vì chạm max_tokens.');
          break;
        }
        const results = [];
        for (const block of message.content) {
          if (block.type === 'tool_use')
            results.push(await runTool(block, controller.signal));
        }
        state.history.push({ role: 'user', content: results });
        if (round === MAX_TOOL_ROUNDS - 1)
          addLine('system', `Dừng sau ${MAX_TOOL_ROUNDS} vòng gọi công cụ.`);
      }
      if (finalText && state.speak) speakText(finalText);
      return true;
    } catch (error) {
      state.history.length = checkpoint;
      addLine(
        'system',
        error?.name === 'AbortError'
          ? 'Đã dừng. Tin này không được lưu vào lịch sử.'
          : `Lỗi: ${error?.message || error}. Tin này không được lưu vào lịch sử.`,
      );
      return false;
    } finally {
      if (requests) {
        if (priced) state.sessionCost += cost;
        else state.sessionPriced = false;
        showUsage(usage, priced, cost);
      }
      state.abort = null;
      setBusy(false);
    }
  }

  // ---- Microphone -------------------------------------------------------

  function updateMic() {
    if (!ui) return;
    ui.mic.setAttribute('aria-pressed', String(state.listening));
    ui.mic.dataset.listening = String(state.listening);
    ui.mic.textContent = state.listening ? '⏺ Gửi' : '🎤 Nói';
  }

  function micErrorText(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed')
      return 'Trình duyệt đang chặn micro. Hãy cho phép quyền micro cho trang này.';
    if (code === 'audio-capture') return 'Không tìm thấy micro.';
    if (code === 'network')
      return 'Lỗi mạng khi nhận giọng nói (trình duyệt gửi âm thanh lên máy chủ nhận dạng của nó).';
    if (code === 'language-not-supported')
      return `Trình duyệt không nhận dạng được ${langLabel(state.lang)}.`;
    return `Nhận giọng nói lỗi: ${code}.`;
  }

  function toggleMic() {
    if (state.listening) {
      state.recognition?.stop();
      return;
    }
    startListening();
  }

  function startListening() {
    const Recognition = recognitionClass();
    if (!Recognition || state.busy || state.listening) return;
    cancelSpeech();
    const recognition = new Recognition();
    recognition.lang = state.lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    let finalText = '';
    let interimText = '';
    let errorCode = '';
    recognition.onresult = (event) => {
      finalText = '';
      interimText = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      ui.interim.textContent = `${finalText} ${interimText}`.trim();
    };
    recognition.onerror = (event) => {
      errorCode = event.error || 'unknown';
    };
    recognition.onend = () => {
      state.listening = false;
      state.recognition = null;
      ui.interim.textContent = '';
      updateMic();
      const transcript = (finalText || interimText).trim();
      if (errorCode && errorCode !== 'no-speech' && errorCode !== 'aborted') {
        addLine('system', micErrorText(errorCode));
        return;
      }
      if (!transcript) {
        if (errorCode === 'no-speech') addLine('system', 'Không nghe thấy gì.');
        return;
      }
      send(transcript, { voice: true });
    };
    state.recognition = recognition;
    state.listening = true;
    updateMic();
    try {
      recognition.start();
    } catch (error) {
      state.listening = false;
      state.recognition = null;
      updateMic();
      addLine('system', `Không bật được micro: ${error?.message || error}`);
    }
  }

  // ---- Read aloud -------------------------------------------------------

  function cancelSpeech() {
    state.speechToken++;
    try {
      win.speechSynthesis?.cancel();
    } catch {
      // Nothing is being read.
    }
  }

  async function pickVoice(lang) {
    const synth = win.speechSynthesis;
    let voices = synth.getVoices?.() || [];
    if (!voices.length) {
      // Chrome loads the voice list asynchronously.
      await new Promise((resolve) => {
        const timer = win.setTimeout(resolve, 1500);
        synth.addEventListener?.(
          'voiceschanged',
          () => {
            win.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      voices = synth.getVoices?.() || [];
    }
    const wanted = lang.toLowerCase();
    const base = wanted.split('-')[0];
    const voiceLang = (voice) =>
      String(voice.lang || '')
        .toLowerCase()
        .replace('_', '-');
    return (
      voices.find((voice) => voiceLang(voice) === wanted) ||
      voices.find((voice) => voiceLang(voice).split('-')[0] === base) ||
      null
    );
  }

  async function checkVoice() {
    if (!hasSpeechSynthesis()) return null;
    const voice = await pickVoice(state.lang);
    notes.voice = voice
      ? ''
      : `Máy này không có giọng đọc ${langLabel(state.lang)}, nên câu trả lời sẽ không được đọc.`;
    renderNote();
    return voice;
  }

  function speechText(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_#>|~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function speakText(text) {
    if (!hasSpeechSynthesis()) return;
    const clean = speechText(text);
    if (!clean) return;
    const token = ++state.speechToken;
    const voice = await checkVoice();
    if (!voice || token !== state.speechToken || !state.speak) return;
    const utterance = new win.SpeechSynthesisUtterance(clean);
    utterance.lang = state.lang;
    utterance.voice = voice;
    win.speechSynthesis.cancel();
    win.speechSynthesis.speak(utterance);
  }

  function toggleSpeak() {
    state.speak = !state.speak;
    writePref('speak', state.speak ? '1' : '0');
    ui.speak.setAttribute('aria-pressed', String(state.speak));
    if (state.speak) checkVoice();
    else {
      cancelSpeech();
      notes.voice = '';
      renderNote();
    }
  }

  // ---- Runner hand-off from gevRealtime.js ------------------------------

  function shareRunner(runner) {
    state.runner = typeof runner === 'function' ? runner : null;
    notes.tools = state.runner
      ? ''
      : 'Không mượn được bộ công cụ của app: Claude trò chuyện được nhưng không điều khiển được bản đồ.';
    try {
      mount();
      renderNote();
    } catch (error) {
      // The voice agent must start even if the chat panel cannot.
      win.console?.warn?.('[claude-chat] panel failed to mount', error);
    }
    return runner;
  }

  return {
    shareRunner,
    mount,
    send,
    setOpen,
    get state() {
      return state;
    },
    get ui() {
      return ui;
    },
  };
}

export {
  CLAUDE_EFFORTS,
  CLAUDE_FALLBACK_BETA,
  CLAUDE_MODEL_DEFAULT,
  CLAUDE_SYSTEM_PROMPT,
  CLAUDE_TOOLS,
  MAX_OUTPUT_TOKENS,
  RESOLVED_VIRTUAL_ID,
  VIRTUAL_ID,
  VOICE_TURN_NOTE,
  buildClaudeRequest,
  claudeChatClient,
  claudeChatModuleSource,
  claudeChatPlugin,
  createClaudeChatHandler,
  createClaudeStatusHandler,
  patchGevRealtime,
  prepareClaudeMessages,
  resolveClaudeConfig,
};
