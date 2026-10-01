import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import {
  CLAUDE_TOOLS,
  claudeChatClient,
} from '../../server/providers/claude-chat.js';

const TOOL_SCHEMAS = Object.fromEntries(
  CLAUDE_TOOLS.map(({ name, input_schema }) => [name, input_schema]),
);

const textReply = (text, usage = {}) => ({
  model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5, ...usage },
});

const toolReply = (name, input) => ({
  model: 'claude-sonnet-5-5',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'tool_use', id: 'toolu_1', name, input },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 10, output_tokens: 5 },
});

/** One SpeechRecognition results list, as the browser builds it. */
function results(entries) {
  return entries.map(([transcript, isFinal]) =>
    Object.assign([{ transcript }], { isFinal }),
  );
}

async function settle(check, label = 'condition') {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

function setup({
  recognition = 'webkitSpeechRecognition',
  synthesis = true,
  voices = [{ lang: 'vi-VN', name: 'Linh' }],
  models = ['claude-sonnet-5-5'],
  replies = [],
  geminiConfigured = true,
  local = { reachable: true, installed: true },
  toolSchemas = null,
  claudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'],
} = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const win = dom.window;
  const events = [];
  const chatBodies = [];
  let statusCalls = 0;
  const queue = [...replies];

  const statusProviders = [];
  win.fetch = async (url, init = {}) => {
    const [path, query = ''] = url.split('?');
    events.push(`fetch ${path}`);
    if (path === '/api/claude/status') {
      const provider = new URLSearchParams(query).get('provider');
      statusProviders.push(provider);
      const model =
        provider === 'gemini'
          ? 'gemini-flash-latest'
          : provider === 'local'
            ? 'qwen3:14b'
            : models[Math.min(statusCalls++, models.length - 1)];
      const body = {
        provider,
        configured: provider === 'gemini' ? geminiConfigured : true,
        model,
        maxTokens: provider === 'local' ? 8192 : 16000,
        effort: provider === 'claude' && claudeEfforts.length ? 'medium' : null,
        efforts:
          provider === 'claude' ? claudeEfforts : ['low', 'medium', 'high'],
        providers: {
          local: { baseURL: 'http://localhost:11434', ...local },
        },
      };
      return { ok: true, status: 200, json: async () => body };
    }
    chatBodies.push(JSON.parse(init.body));
    const next = queue.shift() || textReply('ok');
    const reply = typeof next === 'function' ? await next() : next;
    if (reply.httpStatus)
      return {
        ok: false,
        status: reply.httpStatus,
        json: async () => reply.body,
      };
    return { ok: true, status: 200, json: async () => reply };
  };

  const recognitions = [];
  if (recognition) {
    win[recognition] = class FakeRecognition {
      constructor() {
        recognitions.push(this);
      }
      start() {
        events.push('recognition.start');
        this.started = true;
      }
      stop() {
        events.push('recognition.stop');
        this.stopped = true;
      }
    };
  }

  const spoken = [];
  if (synthesis) {
    win.speechSynthesis = {
      cancel() {
        events.push('speech.cancel');
      },
      speak(utterance) {
        spoken.push(utterance);
      },
      getVoices: () => voices,
      addEventListener() {},
    };
    win.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
  }

  // Evaluated inside the jsdom realm, as the browser runs the virtual module:
  // any reference to this file's module scope would throw here.
  const createClaudeChat = win.eval(`(${claudeChatClient.toString()})`);
  const chat = createClaudeChat(win, { toolSchemas });
  return {
    win,
    chat,
    events,
    chatBodies,
    recognitions,
    spoken,
    statusProviders,
  };
}

function pickMode(chat, value) {
  chat.ui.modeInputs.find((input) => input.value === value).click();
}

function effortChoices(chat) {
  return [...chat.ui.effortList.querySelectorAll('label')].map((label) => {
    const input = label.querySelector('input');
    return `${input.checked ? '*' : ''}${input.value}=${label.textContent}`;
  });
}

function pickEffort(chat, value) {
  chat.ui.effortList.querySelector(`input[value="${value}"]`).click();
}

test('spoken transcript goes through send() and is marked as voice', async () => {
  const { chat, events, chatBodies, recognitions } = setup({
    replies: [textReply('Đang bay tới Paris.')],
  });
  chat.shareRunner(async () => ({ ok: true }));
  chat.setOpen(true);
  const { ui } = chat;
  assert.equal(ui.mic.hidden, false);

  ui.mic.click();
  const recognition = recognitions[0];
  assert.equal(recognition.lang, 'vi-VN');
  assert.equal(recognition.interimResults, true);
  assert.equal(recognition.continuous, false);
  assert.equal(ui.mic.getAttribute('aria-pressed'), 'true');

  recognition.onresult({ results: results([['bay tới', false]]) });
  assert.equal(ui.interim.textContent, 'bay tới');
  recognition.onresult({ results: results([['bay tới Paris', true]]) });
  assert.equal(ui.interim.textContent, 'bay tới Paris');

  // Second press stops listening; the browser then ends the session.
  ui.mic.click();
  assert.equal(recognition.stopped, true);
  recognition.onend();
  assert.equal(ui.interim.textContent, '');

  await settle(() => chatBodies.length === 1 && !chat.state.busy, 'reply');
  assert.deepEqual(chatBodies[0].messages, [
    { role: 'user', content: 'bay tới Paris', voice: true },
  ]);
  assert.ok(
    events.indexOf('fetch /api/claude/status') <
      events.indexOf('fetch /api/claude/chat'),
    'status is checked before each message',
  );
  const lines = [...ui.log.children].map((line) => line.textContent);
  assert.deepEqual(lines.slice(-2), [
    '🎤 bay tới Paris',
    'Đang bay tới Paris.',
  ]);
});

test('voice turns use the same tool loop and the shared runner', async () => {
  const { chat, chatBodies, recognitions } = setup({
    replies: [
      toolReply('fly_to_location', { query: 'Paris' }),
      textReply('Đã tới Paris.'),
    ],
  });
  const runs = [];
  chat.shareRunner(async (name, args, options) => {
    runs.push({ name, args, hasSignal: Boolean(options?.signal) });
    return { ok: true, action: name };
  });
  chat.setOpen(true);
  chat.ui.mic.click();
  recognitions[0].onresult({ results: results([['bay tới Paris', true]]) });
  recognitions[0].onend();

  await settle(() => chatBodies.length === 2 && !chat.state.busy, 'tool loop');
  assert.deepEqual(runs, [
    { name: 'fly_to_location', args: { query: 'Paris' }, hasSignal: true },
  ]);
  const [assistant, toolTurn] = chatBodies[1].messages.slice(1);
  // Thinking blocks go back exactly as received.
  assert.deepEqual(
    assistant.content,
    toolReply('fly_to_location', { query: 'Paris' }).content,
  );
  assert.deepEqual(toolTurn, {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: '{"ok":true,"action":"fly_to_location"}',
      },
    ],
  });
  assert.equal(chat.state.history.length, 4);
});

test('pressing the mic stops read-aloud before listening', () => {
  const { chat, events } = setup();
  chat.shareRunner(async () => ({ ok: true }));
  chat.setOpen(true);
  events.length = 0;
  chat.ui.mic.click();
  assert.deepEqual(events.slice(0, 2), ['speech.cancel', 'recognition.start']);
});

test('without SpeechRecognition the mic is hidden and the reason shown', () => {
  const { chat } = setup({ recognition: null });
  chat.shareRunner(async () => ({ ok: true }));
  const { ui } = chat;
  assert.equal(ui.mic.hidden, true);
  assert.match(ui.note.textContent, /Firefox/);
  assert.match(ui.note.textContent, /gõ chữ vẫn dùng được/);
  assert.equal(ui.speak.hidden, false);
});

test('the unprefixed SpeechRecognition is used when present', () => {
  const { chat, recognitions } = setup({ recognition: 'SpeechRecognition' });
  chat.shareRunner(async () => ({ ok: true }));
  chat.ui.lang.value = 'en-US';
  chat.ui.lang.dispatchEvent(
    new chat.ui.lang.ownerDocument.defaultView.Event('change'),
  );
  chat.ui.mic.click();
  assert.equal(recognitions[0].lang, 'en-US');
});

test('read-aloud picks a voice for the chosen language', async () => {
  const { chat, spoken } = setup({
    voices: [
      { lang: 'en-US', name: 'Sam' },
      { lang: 'vi-VN', name: 'Linh' },
    ],
    replies: [textReply('**Xin chào** từ `Claude`')],
  });
  chat.shareRunner(async () => ({ ok: true }));
  chat.ui.speak.click();
  assert.equal(chat.ui.speak.getAttribute('aria-pressed'), 'true');
  await chat.send('chào');
  await settle(() => spoken.length === 1, 'speech');
  assert.equal(spoken[0].voice.name, 'Linh');
  assert.equal(spoken[0].lang, 'vi-VN');
  assert.equal(spoken[0].text, 'Xin chào từ Claude');
});

test('no matching voice shows a note instead of an error', async () => {
  const { chat, spoken } = setup({
    voices: [{ lang: 'en-US', name: 'Sam' }],
    replies: [textReply('Xin chào')],
  });
  chat.shareRunner(async () => ({ ok: true }));
  chat.ui.speak.click();
  assert.equal(await chat.send('chào'), true);
  await settle(
    () => /không có giọng đọc/.test(chat.ui.note.textContent),
    'note',
  );
  assert.equal(spoken.length, 0);
  const lines = [...chat.ui.log.children].map((line) => line.textContent);
  assert.equal(
    lines.some((line) => line.startsWith('Lỗi')),
    false,
  );
});

test('typed messages are not marked as voice and show token cost', async () => {
  const { chat, chatBodies } = setup({
    replies: [
      textReply('Chào bạn', {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 10000,
      }),
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  chat.ui.input.value = 'xin chào';
  chat.ui.form.requestSubmit();
  await settle(() => chatBodies.length === 1 && !chat.state.busy, 'reply');
  assert.deepEqual(chatBodies[0].messages, [
    { role: 'user', content: 'xin chào' },
  ]);
  const usage = chat.ui.usage.textContent;
  assert.match(
    usage,
    /vào 1,000 · ra 500 · cache ghi 2,000 · cache đọc 10,000/,
  );
  // (1000×2 + 500×10 + 2000×2.5 + 10000×0.2) / 1e6
  assert.match(usage, /≈ \$0\.0140 tin này/);
});

test('a model change clears the history first', async () => {
  const { chat, chatBodies } = setup({
    models: ['claude-sonnet-5-5', 'claude-opus-5-5'],
    replies: [textReply('một'), textReply('hai')],
  });
  chat.shareRunner(async () => ({ ok: true }));
  await chat.send('lần 1');
  assert.equal(chat.state.history.length, 2);
  await chat.send('lần 2');
  assert.deepEqual(chatBodies[1].messages, [
    { role: 'user', content: 'lần 2' },
  ]);
  const lines = [...chat.ui.log.children].map((line) => line.textContent);
  assert.ok(
    lines.some((line) =>
      line.startsWith(
        'Đổi từ Claude claude-sonnet-5-5 sang Claude claude-opus-5-5',
      ),
    ),
  );
});

test('keys typed in the chat never reach the app shortcuts', async () => {
  const { win, chat, chatBodies } = setup({ replies: [textReply('ok')] });
  chat.shareRunner(async () => ({ ok: true }));
  chat.setOpen(true);
  const seen = [];
  win.document.addEventListener('keydown', (e) => seen.push(e.key), true);
  win.document.addEventListener('keyup', (e) => seen.push(e.key), true);
  const key = (target, type, init) =>
    target.dispatchEvent(
      new win.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
    );

  key(chat.ui.input, 'keydown', { key: ' ', code: 'Space' });
  key(chat.ui.input, 'keyup', { key: ' ', code: 'Space' });
  key(chat.ui.mic, 'keydown', { key: ' ', code: 'Space' });
  assert.deepEqual(seen, []);
  key(win.document.body, 'keydown', { key: ' ', code: 'Space' });
  assert.deepEqual(seen, [' ']);

  chat.ui.input.value = 'gửi bằng Enter';
  key(chat.ui.input, 'keydown', { key: 'Enter', isComposing: true });
  assert.equal(chatBodies.length, 0, 'IME composition must not send');
  key(chat.ui.input, 'keydown', { key: 'Enter' });
  await settle(() => chatBodies.length === 1 && !chat.state.busy, 'reply');
  assert.deepEqual(chatBodies[0].messages, [
    { role: 'user', content: 'gửi bằng Enter' },
  ]);
});

test('without a runner Claude is told the tools are unavailable', async () => {
  const { chat, chatBodies } = setup({
    replies: [toolReply('zoom_to_globe', {}), textReply('Không được.')],
  });
  chat.shareRunner(null);
  assert.match(chat.ui.note.textContent, /không điều khiển được bản đồ/);
  await chat.send('toàn cầu');
  const toolTurn = chatBodies[1].messages[2];
  assert.equal(toolTurn.content[0].is_error, true);
});

test('a refusal is not kept in the history', async () => {
  const { chat } = setup({
    replies: [
      {
        model: 'claude-sonnet-5-5',
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber' },
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  await chat.send('something');
  assert.equal(chat.state.history.length, 0);
  const lines = [...chat.ui.log.children].map((line) => line.textContent);
  assert.match(lines.at(-1), /từ chối.*cyber/);
});

test('shareRunner hands the runner back and mounts a single panel', () => {
  const { chat } = setup();
  const runner = async () => ({ ok: true });
  assert.equal(chat.shareRunner(runner), runner);
  // Mounting twice (HMR) keeps a single panel.
  chat.mount();
  assert.equal(
    chat.ui.root.ownerDocument.querySelectorAll('#gev-claude-chat').length,
    1,
  );
});

test('Claude API mode asks for Claude and prices the message', async () => {
  const { chat, chatBodies, statusProviders } = setup({
    replies: [textReply('Chào')],
  });
  chat.shareRunner(async () => ({ ok: true }));
  assert.deepEqual(
    [...chat.ui.modeInputs].map((input) => input.value),
    ['claude', 'free', 'local'],
  );
  await chat.send('chào');
  assert.deepEqual(statusProviders, ['claude']);
  assert.equal(chatBodies[0].provider, 'claude');
  assert.match(chat.ui.usage.textContent, /≈ \$\d+\.\d{4} tin này/);
});

test('AI local mode runs on Ollama, costs nothing and explains the context size', async () => {
  const { chat, chatBodies } = setup({
    replies: [
      { ...textReply('Xin chào'), model: 'qwen3:14b', provider: 'local' },
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  pickMode(chat, 'local');
  assert.equal(await chat.send('chào'), true);
  assert.equal(chatBodies[0].provider, 'local');
  assert.match(chat.ui.usage.textContent, /AI local: miễn phí/);
  assert.doesNotMatch(chat.ui.usage.textContent, /\$/);
  assert.match(chat.ui.note.textContent, /OLLAMA_CONTEXT_LENGTH=32768/);
  assert.match(chat.ui.model.textContent, /AI local · qwen3:14b/);
});

test('free mode asks Gemini first and shows it as free', async () => {
  const { chat, chatBodies } = setup({
    replies: [
      {
        ...textReply('Chào từ Gemini'),
        model: 'gemini-flash-latest',
        provider: 'gemini',
      },
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  pickMode(chat, 'free');
  await chat.send('chào');
  assert.equal(chatBodies[0].provider, 'gemini');
  assert.match(chat.ui.usage.textContent, /Gemini: \$0 với gói miễn phí/);
});

test('free mode moves to AI local when Gemini runs out and resends the message', async () => {
  const { chat, chatBodies, statusProviders } = setup({
    replies: [
      {
        httpStatus: 429,
        body: { error: 'Quota exceeded', type: 'quota_exhausted' },
      },
      {
        ...textReply('Đang bay tới Paris.'),
        model: 'qwen3:14b',
        provider: 'local',
      },
      { ...textReply('Vẫn local.'), model: 'qwen3:14b', provider: 'local' },
      {
        ...textReply('Gemini lại.'),
        model: 'gemini-flash-latest',
        provider: 'gemini',
      },
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  pickMode(chat, 'free');
  assert.equal(await chat.send('bay tới Paris', { voice: true }), true);
  assert.deepEqual(
    chatBodies.map((body) => body.provider),
    ['gemini', 'local'],
  );
  // The resent message starts a fresh local conversation, still marked as voice.
  assert.deepEqual(chatBodies[1].messages, [
    { role: 'user', content: 'bay tới Paris', voice: true },
  ]);
  const lines = [...chat.ui.log.children].map((line) => line.textContent);
  assert.ok(lines.some((line) => /Gemini báo hết lượt miễn phí/.test(line)));
  assert.equal(lines.at(-1), 'Đang bay tới Paris.');
  assert.equal(chat.state.history.length, 2);

  // Later messages in free mode stay on local...
  await chat.send('tiếp');
  assert.equal(chatBodies[2].provider, 'local');
  // ...until "Miễn phí" is picked again.
  pickMode(chat, 'free');
  await chat.send('thử lại Gemini');
  assert.equal(chatBodies[3].provider, 'gemini');
  assert.equal(statusProviders.includes('local'), true);
});

test('free mode without GEMINI_API_KEY goes straight to AI local', async () => {
  const { chat, chatBodies } = setup({
    geminiConfigured: false,
    replies: [{ ...textReply('local'), model: 'qwen3:14b', provider: 'local' }],
  });
  chat.shareRunner(async () => ({ ok: true }));
  pickMode(chat, 'free');
  await chat.send('chào');
  assert.deepEqual(
    chatBodies.map((body) => body.provider),
    ['local'],
  );
  const lines = [...chat.ui.log.children].map((line) => line.textContent);
  assert.ok(lines.some((line) => /Chưa có GEMINI_API_KEY/.test(line)));
});

test('a 429 in Claude API mode is reported, never moved to local', async () => {
  const { chat, chatBodies } = setup({
    replies: [
      {
        httpStatus: 429,
        body: { error: 'Rate limited', type: 'rate_limit_error' },
      },
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  assert.equal(await chat.send('chào'), false);
  assert.equal(chatBodies.length, 1);
  const lines = [...chat.ui.log.children].map((line) => line.textContent);
  assert.match(lines.at(-1), /^Lỗi: Rate limited \(HTTP 429\)/);
});

test('AI local mode says when Ollama is off or the model is missing', async () => {
  const off = setup({ local: { reachable: false, installed: null } });
  off.chat.shareRunner(async () => ({ ok: true }));
  pickMode(off.chat, 'local');
  assert.equal(await off.chat.send('chào'), false);
  assert.equal(off.chatBodies.length, 0);
  let lines = [...off.chat.ui.log.children].map((line) => line.textContent);
  assert.match(
    lines.at(-1),
    /Không kết nối được Ollama tại http:\/\/localhost:11434/,
  );

  const missing = setup({ local: { reachable: true, installed: false } });
  missing.chat.shareRunner(async () => ({ ok: true }));
  pickMode(missing.chat, 'local');
  assert.equal(await missing.chat.send('chào'), false);
  lines = [...missing.chat.ui.log.children].map((line) => line.textContent);
  assert.equal(
    lines.at(-1),
    'Máy chưa có model qwen3:14b. Chạy lệnh: ollama pull qwen3:14b',
  );
});

test('switching from Claude to AI local clears the history', async () => {
  const { chat, chatBodies } = setup({
    replies: [
      textReply('một'),
      { ...textReply('hai'), model: 'qwen3:14b', provider: 'local' },
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  await chat.send('lần 1');
  pickMode(chat, 'local');
  await chat.send('lần 2');
  assert.deepEqual(chatBodies[1].messages, [
    { role: 'user', content: 'lần 2' },
  ]);
  const lines = [...chat.ui.log.children].map((line) => line.textContent);
  assert.ok(
    lines.some((line) =>
      line.startsWith(
        'Đổi từ Claude claude-sonnet-5-5 sang AI local qwen3:14b',
      ),
    ),
  );
});

test('tool calls with wrong arguments never reach the map', async () => {
  const bad = {
    model: 'claude-sonnet-5-5',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_bad',
        name: 'fly_to_location',
        input: { locationId: 'hanoi', rangeM: 5 },
      },
      { type: 'tool_use', id: 'toolu_ghost', name: 'fly_to_mars', input: {} },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  const { chat, chatBodies } = setup({
    toolSchemas: TOOL_SCHEMAS,
    replies: [
      bad,
      toolReply('fly_to_location', { query: 'Hà Nội' }),
      textReply('Đã tới.'),
    ],
  });
  const runs = [];
  chat.shareRunner(async (name, args) => {
    runs.push([name, args]);
    return { ok: true };
  });
  await chat.send('bay tới Hà Nội');

  // Only the schema-valid retry ran.
  assert.deepEqual(runs, [['fly_to_location', { query: 'Hà Nội' }]]);
  const [enumError, unknown] = chatBodies[1].messages.at(-1).content;
  assert.equal(enumError.is_error, true);
  assert.match(
    enumError.content,
    /fly_to_location\.locationId must be one of: austin/,
  );
  assert.match(enumError.content, /fly_to_location\.rangeM must be >= 100/);
  assert.equal(unknown.is_error, true);
  assert.match(unknown.content, /unknown tool \\"fly_to_mars\\"/);
  const lines = [...chat.ui.log.children].map((line) => line.textContent);
  assert.ok(lines.some((line) => line.endsWith('→ chặn (sai tham số)')));
});

test('the tool check accepts valid calls and reports missing required fields', async () => {
  const { chat, chatBodies } = setup({
    toolSchemas: TOOL_SCHEMAS,
    replies: [
      {
        model: 'claude-sonnet-5-5',
        content: [
          { type: 'tool_use', id: 't1', name: 'zoom_to_globe', input: {} },
          {
            type: 'tool_use',
            id: 't2',
            name: 'set_layer_visibility',
            input: {},
          },
        ],
        stop_reason: 'tool_use',
        usage: {},
      },
      textReply('ok'),
    ],
  });
  const runs = [];
  chat.shareRunner(async (name) => {
    runs.push(name);
    return { ok: true };
  });
  await chat.send('toàn cầu');
  assert.deepEqual(runs, ['zoom_to_globe']);
  const [, missing] = chatBodies[1].messages.at(-1).content;
  assert.match(missing.content, /set_layer_visibility\.\w+ is required/);
});

test('a waiting line counts seconds and clears when the reply lands', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { chat } = setup({
    replies: [
      () =>
        pending.then(() => ({
          ...textReply('xong'),
          model: 'qwen3:14b',
          provider: 'local',
        })),
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  pickMode(chat, 'local');
  const sending = chat.send('chào');
  await settle(() => chat.ui.wait.textContent !== '', 'waiting line');
  assert.match(
    chat.ui.wait.textContent,
    /^⏳ Đang chờ AI local… 0 giây \(có thể đang nạp model vào VRAM\)$/,
  );
  // The panel stays usable while waiting: the button stops the request.
  assert.equal(chat.ui.send.textContent, 'Dừng');
  release();
  assert.equal(await sending, true);
  assert.equal(chat.ui.wait.textContent, '');
});

test('the ⚙ button opens a popup to pick the source and the effort', async () => {
  const { chat, chatBodies } = setup({ replies: [textReply('ok')] });
  chat.shareRunner(async () => ({ ok: true }));
  chat.setOpen(true);
  const { ui } = chat;
  assert.equal(ui.settings.hidden, true);
  ui.settingsButton.click();
  assert.equal(ui.settings.hidden, false);
  assert.equal(ui.settingsButton.getAttribute('aria-expanded'), 'true');
  await settle(() => ui.effortList.children.length === 6, 'effort choices');
  assert.deepEqual(
    [...ui.modeInputs].map(
      (input) => `${input.checked ? '*' : ''}${input.value}`,
    ),
    ['*claude', 'free', 'local'],
  );
  assert.deepEqual(effortChoices(chat), [
    '*=mặc định (medium)',
    'low=low',
    'medium=medium',
    'high=high',
    'xhigh=xhigh',
    'max=max',
  ]);
  assert.equal(ui.effortLegend.textContent, 'Effort (Claude)');
  assert.equal(ui.settingsButton.textContent, '⚙ Claude · medium');

  pickEffort(chat, 'high');
  assert.equal(ui.settingsButton.textContent, '⚙ Claude · high');
  let lines = [...ui.log.children].map((line) => line.textContent);
  assert.match(lines.at(-1), /^Effort Claude: high, áp dụng từ tin kế tiếp\.$/);

  ui.settings.querySelector('.gev-claude-done').click();
  assert.equal(ui.settings.hidden, true);
  await chat.send('chào');
  assert.equal(chatBodies[0].effort, 'high');

  // xhigh/max warn about the output cap; a later change mentions the cache.
  pickEffort(chat, 'max');
  lines = [...ui.log.children].map((line) => line.textContent);
  assert.match(lines.at(-1), /cache/);
  assert.match(lines.at(-1), /16000 token/);
});

test('each source keeps its own effort, and "mặc định" sends none', async () => {
  const { chat, chatBodies } = setup({
    replies: [
      textReply('claude'),
      { ...textReply('local'), model: 'qwen3:14b', provider: 'local' },
      { ...textReply('local 2'), model: 'qwen3:14b', provider: 'local' },
      textReply('claude 2'),
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  chat.setOpen(true);
  chat.ui.settingsButton.click();
  await settle(() => chat.ui.effortList.children.length === 6, 'claude');
  pickEffort(chat, 'high');
  await chat.send('một');

  pickMode(chat, 'local');
  await settle(() => chat.ui.effortList.children.length === 4, 'local');
  assert.equal(chat.ui.effortLegend.textContent, 'Effort (AI local)');
  assert.deepEqual(effortChoices(chat), [
    '*=mặc định',
    'low=low',
    'medium=medium',
    'high=high',
  ]);
  assert.match(chat.ui.effortHint.textContent, /model local hỗ trợ/);
  await chat.send('hai');
  assert.equal('effort' in chatBodies[1], false);
  pickEffort(chat, 'low');
  await chat.send('ba');
  assert.equal(chatBodies[2].effort, 'low');

  pickMode(chat, 'claude');
  await settle(() => chat.ui.effortList.children.length === 6, 'claude again');
  assert.equal(chat.ui.settingsButton.textContent, '⚙ Claude · high');
  await chat.send('bốn');
  assert.equal(chatBodies[3].effort, 'high');
});

test('a model without effort shows no effort choices', async () => {
  const { chat, chatBodies } = setup({ claudeEfforts: [] });
  chat.shareRunner(async () => ({ ok: true }));
  chat.setOpen(true);
  chat.ui.settingsButton.click();
  await settle(
    () => chat.ui.effortHint.textContent === 'Model này không có mức effort.',
    'no effort hint',
  );
  assert.equal(chat.ui.effortList.children.length, 0);
  assert.equal(chat.ui.settingsButton.textContent, '⚙ Claude');
  await chat.send('chào');
  assert.equal('effort' in chatBodies[0], false);
});

test('Escape closes the popup before the panel', async () => {
  const { win, chat } = setup();
  chat.shareRunner(async () => ({ ok: true }));
  chat.setOpen(true);
  chat.ui.settingsButton.click();
  const escape = () =>
    chat.ui.settingsButton.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  escape();
  assert.equal(chat.ui.settings.hidden, true);
  assert.equal(chat.ui.panel.hidden, false);
  escape();
  assert.equal(chat.ui.panel.hidden, true);
});

test('the popup says when free mode is running on AI local', async () => {
  const { chat } = setup({
    replies: [
      { httpStatus: 429, body: { error: 'Quota', type: 'quota_exhausted' } },
      { ...textReply('local'), model: 'qwen3:14b', provider: 'local' },
    ],
  });
  chat.shareRunner(async () => ({ ok: true }));
  pickMode(chat, 'free');
  assert.equal(chat.ui.spent.hidden, true);
  await chat.send('chào');
  assert.equal(chat.ui.spent.hidden, false);
  assert.match(chat.ui.settingsButton.textContent, /^⚙ Miễn phí/);
  pickMode(chat, 'free');
  assert.equal(chat.ui.spent.hidden, true);
});
