import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError, GoogleGenAI } from '@google/genai';
import { realtimeInstructions } from './openai/instructions.js';
import { GEV_REALTIME_TOOLS } from './openai/tools.js';

/**
 * Vite plugin: AI chat panel (typed and spoken) for God's Eye View.
 *
 * The browser picks one of three providers per message:
 * - claude: the Anthropic Messages API (paid); ANTHROPIC_API_KEY stays here.
 * - gemini: the Google Gemini API free tier; GEMINI_API_KEY stays here. The
 *   panel's "free" mode starts here and moves to local on a 429.
 * - local:  an Ollama server through its Anthropic-compatible /v1/messages
 *   endpoint. No key.
 *
 * - GET  /api/claude/status?provider=… reports the model, effort and output cap
 *   the proxy will use. It never returns a key.
 * - POST /api/claude/chat {provider, messages} always answers with one
 *   Anthropic-shaped message, so the browser keeps a single tool loop.
 * - A `transform` hook patches src/voice/gevRealtime.js in memory (the file on
 *   disk is untouched) so the action runner built for the OpenAI voice agent is
 *   shared with the chat panel. Every provider sees the same 30 tools.
 *
 * The browser half lives in `claudeChatClient`. It is serialized into a virtual
 * module with Function#toString, so it must not reference anything outside its
 * own body.
 */

const CHAT_PROVIDERS = ['claude', 'gemini', 'local'];
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
// Google's alias for its newest Flash model. Which models have free quota is
// Google's decision; override with GEMINI_MODEL.
const GEMINI_MODEL_DEFAULT = 'gemini-flash-latest';
const OLLAMA_BASE_URL_DEFAULT = 'http://localhost:11434';
// 9.3 GB and tool-capable in Ollama's library, leaving VRAM for a 32K context
// on a 16 GB card. Override with OLLAMA_MODEL.
const OLLAMA_MODEL_DEFAULT = 'qwen3:14b';
const OLLAMA_MAX_TOKENS_DEFAULT = 8192;
const OLLAMA_PROBE_TIMEOUT_MS = 1500;
const GEMINI_REFUSALS = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
]);

// Appended to user turns that came from the microphone. It rides in the user
// message, never in `system`, so the cached tools+system prefix stays identical.
const VOICE_TURN_NOTE =
  '[Tin này đến từ giọng nói: trả lời ngắn 1–2 câu, không dùng markdown, không đọc JSON]';

function assistantSystemPrompt(opening) {
  return [
    `${opening} inside God's Eye View, a Cesium 3D globe app. The user talks to you in a chat panel, by typing or by voice.`,
    'Reply in the language the user writes in (usually Vietnamese or English).',
    'You control the app only through the provided tools. The guidance below was written for the app\'s realtime voice agent and applies to you too: where it says "speak" or "say", it means your reply.',
    'Typed messages may get short plain-text replies. A user message that ends with a note saying it came from voice gets one or two short sentences, with no markdown and no JSON.',
    '',
    realtimeInstructions(),
  ].join('\n');
}

const CLAUDE_SYSTEM_PROMPT = assistantSystemPrompt(
  'You are Claude, the assistant',
);
// Gemini and local models are not Claude and should not say they are.
const ASSISTANT_SYSTEM_PROMPT = assistantSystemPrompt('You are the assistant');

const CLAUDE_TOOLS = GEV_REALTIME_TOOLS.map(
  ({ name, description, parameters }) => ({
    name,
    description,
    input_schema: parameters,
  }),
);

const GEMINI_FUNCTIONS = GEV_REALTIME_TOOLS.map(
  ({ name, description, parameters }) => ({
    name,
    description,
    parametersJsonSchema: parameters,
  }),
);

const VIRTUAL_ID = 'virtual:gev-claude-chat';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;
const RUNNER_SITE = 'runner: createGevActionRunner(options),';
const SHARED_RUNNER_SITE =
  'runner: __gevClaudeShareRunner(createGevActionRunner(options)),';

let warnedEffort = '';

function positiveInteger(value, fallback) {
  const number = Number(String(value || '').trim());
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/** Read the Claude settings from the environment at request time. */
function resolveClaudeConfig(env = process.env) {
  const model =
    String(env.ANTHROPIC_MODEL || '').trim() || CLAUDE_MODEL_DEFAULT;
  const maxTokens = positiveInteger(
    env.ANTHROPIC_MAX_TOKENS,
    MAX_OUTPUT_TOKENS,
  );
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

function resolveGeminiConfig(env = process.env) {
  return {
    model: String(env.GEMINI_MODEL || '').trim() || GEMINI_MODEL_DEFAULT,
    maxTokens: positiveInteger(env.GEMINI_MAX_TOKENS, MAX_OUTPUT_TOKENS),
  };
}

function resolveLocalConfig(env = process.env) {
  const baseURL =
    String(env.OLLAMA_BASE_URL || '').trim() || OLLAMA_BASE_URL_DEFAULT;
  return {
    model: String(env.OLLAMA_MODEL || '').trim() || OLLAMA_MODEL_DEFAULT,
    maxTokens: positiveInteger(
      env.OLLAMA_MAX_TOKENS,
      OLLAMA_MAX_TOKENS_DEFAULT,
    ),
    baseURL: baseURL.replace(/\/+$/, ''),
  };
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

/** Ollama speaks the same Messages API, minus caching and fallbacks. */
function buildLocalRequest(messages, config) {
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    system: ASSISTANT_SYSTEM_PROMPT,
    tools: CLAUDE_TOOLS,
    messages: prepareClaudeMessages(messages),
  };
}

function toolResultPayload(block) {
  const text =
    typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content)
        ? block.content
            .filter((part) => part?.type === 'text')
            .map((part) => part.text)
            .join('\n')
        : '';
  let value = text;
  try {
    value = JSON.parse(text);
  } catch {
    // Plain-text results stay text.
  }
  const payload =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { result: value };
  return block.is_error ? { error: payload } : payload;
}

/**
 * Anthropic-shaped history → Gemini contents. Gemini's thought signatures and
 * call ids ride on the blocks as gemini_* fields and go back unchanged.
 */
function toGeminiContents(messages) {
  const calls = new Map();
  const contents = [];
  for (const { role, content } of messages) {
    const blocks =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    const parts = [];
    for (const block of blocks) {
      const signature = block?.gemini_thought_signature
        ? { thoughtSignature: block.gemini_thought_signature }
        : {};
      if (block?.type === 'text' && typeof block.text === 'string') {
        if (block.text || signature.thoughtSignature)
          parts.push({ text: block.text, ...signature });
      } else if (block?.type === 'tool_use') {
        calls.set(block.id, block);
        parts.push({
          functionCall: {
            name: block.name,
            args: block.input || {},
            ...(block.gemini_call_id ? { id: block.gemini_call_id } : {}),
          },
          ...signature,
        });
      } else if (block?.type === 'tool_result') {
        const call = calls.get(block.tool_use_id);
        if (!call) continue;
        parts.push({
          functionResponse: {
            name: call.name,
            response: toolResultPayload(block),
            ...(call.gemini_call_id ? { id: call.gemini_call_id } : {}),
          },
        });
      }
      // Thinking blocks from other providers have no Gemini form.
    }
    if (parts.length)
      contents.push({ role: role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}

function buildGeminiRequest(messages, config) {
  return {
    model: config.model,
    contents: toGeminiContents(prepareClaudeMessages(messages)),
    config: {
      systemInstruction: ASSISTANT_SYSTEM_PROMPT,
      tools: [{ functionDeclarations: GEMINI_FUNCTIONS }],
      maxOutputTokens: config.maxTokens,
    },
  };
}

/** Gemini response → the Anthropic-shaped message the browser loop expects. */
function fromGeminiResponse(response, requestedModel) {
  const usage = response?.usageMetadata || {};
  const cached = usage.cachedContentTokenCount || 0;
  const id = response?.responseId || `gemini_${Date.now()}`;
  const message = {
    id,
    type: 'message',
    role: 'assistant',
    model: response?.modelVersion || requestedModel,
    provider: 'gemini',
    content: [],
    stop_reason: 'end_turn',
    stop_details: null,
    usage: {
      input_tokens: Math.max(0, (usage.promptTokenCount || 0) - cached),
      output_tokens:
        (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cached,
    },
  };
  const candidate = response?.candidates?.[0];
  if (!candidate) {
    message.stop_reason = 'refusal';
    message.stop_details = {
      type: 'refusal',
      category: response?.promptFeedback?.blockReason || null,
    };
    return message;
  }
  let calls = 0;
  for (const part of candidate.content?.parts || []) {
    if (part.thought) continue;
    const signature = part.thoughtSignature
      ? { gemini_thought_signature: part.thoughtSignature }
      : {};
    if (part.functionCall) {
      calls++;
      const { id: callId, name, args } = part.functionCall;
      message.content.push({
        type: 'tool_use',
        id: callId || `${id}_call_${calls}`,
        name,
        input: args || {},
        ...(callId ? { gemini_call_id: callId } : {}),
        ...signature,
      });
    } else if (typeof part.text === 'string' || part.thoughtSignature) {
      message.content.push({
        type: 'text',
        text: part.text || '',
        ...signature,
      });
    }
  }
  const finish = candidate.finishReason;
  if (GEMINI_REFUSALS.has(finish)) {
    message.stop_reason = 'refusal';
    message.stop_details = { type: 'refusal', category: finish };
  } else if (calls) {
    message.stop_reason = 'tool_use';
  } else if (finish === 'MAX_TOKENS') {
    message.stop_reason = 'max_tokens';
  } else if (finish === 'MALFORMED_FUNCTION_CALL') {
    message.content.push({
      type: 'text',
      text: 'Gemini tạo lời gọi công cụ bị lỗi. Hãy thử nói lại yêu cầu.',
    });
  }
  return message;
}

/** Gemini errors carry the upstream JSON after a status prefix. */
function geminiErrorMessage(error) {
  const text = String(error?.message || error);
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(text.slice(start));
      if (parsed?.error?.message) return parsed.error.message;
    } catch {
      // Fall back to the raw message.
    }
  }
  return text;
}

async function probeOllama({ baseURL, model }, fetchImpl) {
  try {
    const response = await fetchImpl(`${baseURL}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { reachable: true, installed: null };
    const { models = [] } = await response.json();
    const names = models.flatMap((entry) => [entry?.name, entry?.model]);
    return {
      reachable: true,
      installed:
        names.includes(model) ||
        (!model.includes(':') && names.includes(`${model}:latest`)),
    };
  } catch {
    return { reachable: false, installed: null };
  }
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

function createClaudeStatusHandler({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    let requested = 'claude';
    try {
      requested =
        new URL(req.url || '/', 'http://localhost').searchParams.get(
          'provider',
        ) || 'claude';
    } catch {
      // Keep the default.
    }
    const provider = CHAT_PROVIDERS.includes(requested) ? requested : 'claude';
    const claude = resolveClaudeConfig(env);
    const gemini = resolveGeminiConfig(env);
    const local = resolveLocalConfig(env);
    const providers = {
      claude: {
        configured: Boolean(env.ANTHROPIC_API_KEY),
        model: claude.model,
      },
      gemini: { configured: Boolean(env.GEMINI_API_KEY), model: gemini.model },
      local: { configured: true, model: local.model, baseURL: local.baseURL },
    };
    if (provider === 'local')
      Object.assign(providers.local, await probeOllama(local, fetchImpl));
    const settings =
      provider === 'claude'
        ? claude
        : {
            ...(provider === 'gemini' ? gemini : local),
            effort: null,
            fallbacks: false,
          };
    sendJson(res, 200, {
      provider,
      configured: providers[provider].configured,
      model: settings.model,
      maxTokens: settings.maxTokens,
      effort: settings.effort,
      fallbacks: settings.fallbacks,
      providers,
    });
  };
}

function createClaudeChatHandler({
  env = process.env,
  baseURL,
  geminiBaseURL,
  createClient = (options) => new Anthropic(options),
  createGeminiClient = (options) => new GoogleGenAI(options),
} = {}) {
  const clients = new Map();
  const cachedClient = (key, make) => {
    if (!clients.has(key)) clients.set(key, make());
    return clients.get(key);
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

    let provider;
    let call;
    try {
      const body = JSON.parse(
        await readRequestBody(req, CLAUDE_REQUEST_MAX_BYTES),
      );
      provider = body?.provider ?? 'claude';
      if (!CHAT_PROVIDERS.includes(provider))
        throw new TypeError(`Unknown provider: ${provider}`);
      const keyName =
        provider === 'claude'
          ? 'ANTHROPIC_API_KEY'
          : provider === 'gemini'
            ? 'GEMINI_API_KEY'
            : null;
      if (keyName && !env[keyName]) {
        sendJson(res, 503, {
          error: `${keyName} is not set`,
          type: 'not_configured',
        });
        return;
      }
      call = prepareProviderCall(provider, body?.messages);
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
      sendJson(res, 200, await call(abort.signal));
    } catch (error) {
      if (abort.signal.aborted) return;
      const [status, body] = providerError(provider, error);
      if (status >= 500)
        console.warn(`[claude-chat] ${provider} request failed`);
      sendJson(res, status, body);
    }
  };

  /** Validate and build the request now; return the network call for later. */
  function prepareProviderCall(provider, messages) {
    if (provider === 'claude') {
      const apiKey = env.ANTHROPIC_API_KEY;
      const params = buildClaudeRequest(messages, resolveClaudeConfig(env));
      const client = cachedClient(`claude:${apiKey}`, () =>
        createClient({ apiKey, ...(baseURL ? { baseURL } : {}) }),
      );
      // Streamed upstream so a large max_tokens cannot hit the SDK's
      // non-streaming timeout; the browser still gets one complete message.
      return async (signal) => ({
        ...(await client.beta.messages
          .stream(params, { signal })
          .finalMessage()),
        provider,
      });
    }
    if (provider === 'local') {
      const config = resolveLocalConfig(env);
      const params = buildLocalRequest(messages, config);
      const client = cachedClient(`local:${config.baseURL}`, () =>
        // Ollama ignores the key. No retries: a stopped server should say so
        // at once.
        createClient({
          apiKey: 'ollama',
          baseURL: config.baseURL,
          maxRetries: 0,
        }),
      );
      return async (signal) => ({
        ...(await client.messages.stream(params, { signal }).finalMessage()),
        provider,
      });
    }
    const apiKey = env.GEMINI_API_KEY;
    const config = resolveGeminiConfig(env);
    const request = buildGeminiRequest(messages, config);
    const client = cachedClient(`gemini:${apiKey}`, () =>
      createGeminiClient({
        apiKey,
        ...(geminiBaseURL ? { httpOptions: { baseUrl: geminiBaseURL } } : {}),
      }),
    );
    return async (signal) =>
      fromGeminiResponse(
        await client.models.generateContent({
          ...request,
          config: { ...request.config, abortSignal: signal },
        }),
        config.model,
      );
  }

  function providerError(provider, error) {
    if (provider === 'gemini') {
      if (error instanceof GeminiApiError && error.status) {
        const message = geminiErrorMessage(error);
        // Free-tier quota (per minute or per day) is spent.
        if (error.status === 429)
          return [429, { error: message, type: 'quota_exhausted' }];
        return [error.status, { error: message }];
      }
      return [502, { error: 'Could not reach the Gemini API' }];
    }
    if (error instanceof Anthropic.APIError && error.status) {
      return [
        error.status,
        {
          error:
            error.error?.error?.message ||
            error.error?.message ||
            error.message,
          type: error.error?.error?.type,
        },
      ];
    }
    if (provider === 'local') {
      const { baseURL: localURL } = resolveLocalConfig(env);
      return [
        502,
        {
          error: `Không kết nối được Ollama tại ${localURL}. Hãy mở Ollama rồi thử lại.`,
          type: 'local_unreachable',
        },
      ];
    }
    return [502, { error: 'Could not reach the Anthropic API' }];
  }
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
  // "free" asks Gemini first and moves to the local model once Gemini reports
  // its free quota spent (HTTP 429). Picking "free" again retries Gemini.
  const MODES = [
    ['claude', 'Claude API (trả phí)'],
    ['free', 'Miễn phí: Gemini → AI local'],
    ['local', 'AI local (Ollama)'],
  ];
  const PROVIDER_LABELS = {
    claude: 'Claude',
    gemini: 'Gemini',
    local: 'AI local',
  };
  const FREE_LABELS = {
    gemini: 'Gemini: $0 với gói miễn phí',
    local: 'AI local: miễn phí',
  };
  const CSS = `
#gev-claude-chat{position:fixed;left:16px;bottom:16px;z-index:1200;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e6edf3}
#gev-claude-chat button,#gev-claude-chat select,#gev-claude-chat textarea{font:inherit;color:inherit}
.gev-claude-toggle{background:#1b2230e6;border:1px solid #3b4a63;border-radius:18px;padding:6px 14px;cursor:pointer}
.gev-claude-toggle[aria-expanded="true"]{display:none}
.gev-claude-panel{width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;background:#10151ef2;border:1px solid #3b4a63;border-radius:10px;box-shadow:0 8px 28px #0008;overflow:hidden}
.gev-claude-panel[hidden]{display:none}
.gev-claude-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #263041}
.gev-claude-title{font-weight:600}
.gev-claude-model{padding:4px 10px 0;opacity:.65;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gev-claude-mode{flex:1;min-width:0;background:#1b2230;border:1px solid #3b4a63;border-radius:6px;padding:2px 4px}
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
    modelLabel: '',
    mode: MODES.some(([value]) => value === readPref('mode', ''))
      ? readPref('mode', '')
      : 'claude',
    geminiSpent: false,
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
  const notes = { support: [], tools: '', provider: '', voice: '' };
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
      text: 'Chat AI',
    });
    const mode = el(
      'select',
      { class: 'gev-claude-mode', 'aria-label': 'Chọn AI' },
      MODES.map(([value, label]) => el('option', { value, text: label })),
    );
    mode.value = state.mode;
    const model = el('div', { class: 'gev-claude-model' });
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
      'aria-label': 'Tin nhắn cho AI',
      placeholder: 'Nhắn cho AI… (Enter để gửi, Shift+Enter xuống dòng)',
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
        'aria-label': 'Chat với AI',
        hidden: true,
      },
      [
        el('div', { class: 'gev-claude-head' }, [
          el('span', { class: 'gev-claude-title', text: 'Chat AI' }),
          mode,
          clear,
          close,
        ]),
        model,
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
      mode,
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
    mode.addEventListener('change', () => {
      state.mode = mode.value;
      state.geminiSpent = false;
      writePref('mode', state.mode);
      refreshStatus();
    });
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
    ui.note.textContent = [
      ...notes.support,
      notes.tools,
      notes.provider,
      notes.voice,
    ]
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

  function providerForMode() {
    if (state.mode === 'free') return state.geminiSpent ? 'local' : 'gemini';
    return state.mode;
  }

  function localProblem(status) {
    const local = status.providers?.local || {};
    if (local.reachable === false)
      return `Không kết nối được Ollama tại ${local.baseURL}. Hãy mở Ollama rồi thử lại.`;
    if (local.installed === false)
      return `Máy chưa có model ${status.model}. Chạy lệnh: ollama pull ${status.model}`;
    return '';
  }

  function showProvider(status) {
    const provider = status.provider || providerForMode();
    const label = `${PROVIDER_LABELS[provider] || provider} · ${status.model}`;
    let problem = '';
    if (!status.configured)
      problem =
        provider === 'gemini'
          ? 'chưa có GEMINI_API_KEY, sẽ dùng AI local'
          : 'chưa có ANTHROPIC_API_KEY';
    else if (provider === 'local') problem = localProblem(status);
    ui.model.textContent = problem ? `${label} (${problem})` : label;
    notes.provider =
      provider === 'local'
        ? 'AI local: đặt OLLAMA_CONTEXT_LENGTH=32768 cho Ollama, vì hướng dẫn và 30 công cụ của app dài khoảng 14 nghìn token (Ollama mặc định chỉ đọc 4096).'
        : '';
    renderNote();
  }

  async function refreshStatus() {
    try {
      showProvider(await fetchStatus(providerForMode()));
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

  async function fetchStatus(provider, signal) {
    const url = `/api/claude/status?provider=${encodeURIComponent(provider)}`;
    const response = await win.fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      throw new Error(`/api/claude/status trả về HTTP ${response.status}`);
    return response.json();
  }

  async function postChat(messages, provider, signal) {
    const response = await win.fetch('/api/claude/chat', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, messages }),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok)
      throw Object.assign(
        new Error(
          data?.error
            ? `${data.error} (HTTP ${response.status})`
            : `HTTP ${response.status}`,
        ),
        { status: response.status, type: data?.type },
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

  function showUsage(usage, priced, cost, freeLabel) {
    const parts = [
      `Token: vào ${formatCount(usage.input)} · ra ${formatCount(usage.output)} · cache ghi ${formatCount(usage.cacheWrite)} · cache đọc ${formatCount(usage.cacheRead)}`,
    ];
    if (freeLabel) {
      parts.push(freeLabel);
    } else if (priced) {
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
    let freeLabel = '';
    let requests = 0;
    let checkpoint = state.history.length;
    let provider = providerForMode();
    let outcome = false;
    let retryOnLocal = false;
    try {
      let status = await fetchStatus(provider, controller.signal);
      if (provider === 'gemini' && !status.configured) {
        state.geminiSpent = true;
        addLine(
          'system',
          'Chưa có GEMINI_API_KEY nên chế độ miễn phí dùng AI local.',
        );
        provider = 'local';
        status = await fetchStatus(provider, controller.signal);
      }
      provider = status.provider || provider;
      showProvider(status);
      if (!status.configured) {
        addLine(
          'system',
          'Server chưa có ANTHROPIC_API_KEY. Thêm key vào .env rồi khởi động lại npm run dev.',
        );
        return false;
      }
      if (provider === 'local' && localProblem(status)) {
        addLine('system', localProblem(status));
        return false;
      }
      // Thinking blocks are bound to the model that wrote them, and each
      // provider keeps its own block format.
      const identity = `${provider}:${status.model}`;
      const identityLabel = `${PROVIDER_LABELS[provider] || provider} ${status.model}`;
      if (state.model && identity !== state.model && state.history.length) {
        state.history = [];
        addLine(
          'system',
          `Đổi từ ${state.modelLabel} sang ${identityLabel}: đã xoá lịch sử hội thoại.`,
        );
      }
      state.model = identity;
      state.modelLabel = identityLabel;
      checkpoint = state.history.length;

      addLine('user', voice ? `🎤 ${text}` : text);
      state.history.push(
        voice
          ? { role: 'user', content: text, voice: true }
          : { role: 'user', content: text },
      );
      let finalText = '';
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const message = await postChat(
          state.history,
          provider,
          controller.signal,
        );
        requests++;
        const used = message.usage || {};
        const turnUsage = {
          input: used.input_tokens || 0,
          output: used.output_tokens || 0,
          cacheWrite: used.cache_creation_input_tokens || 0,
          cacheRead: used.cache_read_input_tokens || 0,
        };
        for (const key of Object.keys(usage)) usage[key] += turnUsage[key];
        const servedBy = message.provider || provider;
        const price = PRICES[message.model] || PRICES[status.model];
        if (FREE_LABELS[servedBy]) {
          freeLabel = FREE_LABELS[servedBy];
        } else if (price) {
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
            `${PROVIDER_LABELS[servedBy] || servedBy} từ chối yêu cầu này${category ? ` (${category})` : ''}. Tin này không được lưu vào lịch sử.`,
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
      outcome = true;
    } catch (error) {
      state.history.length = checkpoint;
      if (
        error?.type === 'quota_exhausted' &&
        provider === 'gemini' &&
        state.mode === 'free'
      ) {
        state.geminiSpent = true;
        retryOnLocal = true;
        addLine(
          'system',
          'Gemini báo hết lượt miễn phí. Đã chuyển sang AI local và gửi lại tin này. Chọn lại "Miễn phí" để thử Gemini lần nữa.',
        );
      } else {
        addLine(
          'system',
          error?.name === 'AbortError'
            ? 'Đã dừng. Tin này không được lưu vào lịch sử.'
            : `Lỗi: ${error?.message || error}. Tin này không được lưu vào lịch sử.`,
        );
      }
    } finally {
      if (requests) {
        // Free providers add nothing to the session cost.
        if (!freeLabel) {
          if (priced) state.sessionCost += cost;
          else state.sessionPriced = false;
        }
        showUsage(usage, priced, cost, freeLabel);
      }
      state.abort = null;
      setBusy(false);
    }
    if (retryOnLocal) return send(text, { voice });
    return outcome;
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
  ASSISTANT_SYSTEM_PROMPT,
  CHAT_PROVIDERS,
  CLAUDE_EFFORTS,
  CLAUDE_FALLBACK_BETA,
  CLAUDE_MODEL_DEFAULT,
  CLAUDE_SYSTEM_PROMPT,
  CLAUDE_TOOLS,
  GEMINI_MODEL_DEFAULT,
  MAX_OUTPUT_TOKENS,
  OLLAMA_BASE_URL_DEFAULT,
  OLLAMA_MODEL_DEFAULT,
  RESOLVED_VIRTUAL_ID,
  VIRTUAL_ID,
  VOICE_TURN_NOTE,
  buildClaudeRequest,
  buildGeminiRequest,
  buildLocalRequest,
  claudeChatClient,
  claudeChatModuleSource,
  claudeChatPlugin,
  createClaudeChatHandler,
  createClaudeStatusHandler,
  fromGeminiResponse,
  patchGevRealtime,
  prepareClaudeMessages,
  resolveClaudeConfig,
  resolveGeminiConfig,
  resolveLocalConfig,
  toGeminiContents,
};
