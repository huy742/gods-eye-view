import assert from 'node:assert/strict';
import test from 'node:test';

import { setupLocalAi } from '../../scripts/setup-local-ai.mjs';

function harness({
  ollamaInstalled = true,
  tags = [],
  reachable = true,
  platform = 'win32',
  env = {},
  failing = [],
} = {}) {
  const commands = [];
  const logs = [];
  const result = (ok) => ({ status: ok ? 0 : 1, error: undefined });
  return {
    commands,
    logs,
    run: () =>
      setupLocalAi({
        env,
        platform,
        probe: (command, args) => {
          commands.push(['probe', command, ...args]);
          return ollamaInstalled
            ? result(true)
            : { status: null, error: new Error('ENOENT') };
        },
        run: (command, args) => {
          commands.push([command, ...args]);
          return result(!failing.includes(command));
        },
        fetchImpl: async (url) => {
          commands.push(['fetch', url]);
          if (!reachable) throw new TypeError('fetch failed');
          return { json: async () => ({ models: tags }) };
        },
        log: (line) => logs.push(line),
      }),
  };
}

test('missing Ollama points to the official download and stops', async () => {
  const h = harness({ ollamaInstalled: false });
  assert.equal(await h.run(), 1);
  assert.match(h.logs[0], /https:\/\/ollama\.com\/download/);
  assert.deepEqual(h.commands, [['probe', 'ollama', '--version']]);
});

test('a stopped Ollama is reported before any download', async () => {
  const h = harness({ reachable: false });
  assert.equal(await h.run(), 1);
  assert.match(h.logs[0], /chưa chạy ở http:\/\/localhost:11434/);
  assert.equal(
    h.commands.some(([command]) => command === 'ollama'),
    false,
  );
});

test('pulls the default model and sets the context length on Windows', async () => {
  const h = harness();
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.commands.slice(1), [
    ['fetch', 'http://localhost:11434/api/tags'],
    ['ollama', 'pull', 'qwen3:14b'],
    ['setx', 'OLLAMA_CONTEXT_LENGTH', '32768'],
  ]);
  assert.match(h.logs.join('\n'), /Thoát Ollama ở khay hệ thống/);
});

test('an installed model and a long enough context need no changes', async () => {
  const h = harness({
    tags: [{ name: 'gpt-oss:20b', model: 'gpt-oss:20b' }],
    env: {
      OLLAMA_MODEL: 'gpt-oss:20b',
      OLLAMA_CONTEXT_LENGTH: '40000',
      OLLAMA_BASE_URL: 'http://127.0.0.1:9999/',
    },
  });
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.commands.slice(1), [
    ['fetch', 'http://127.0.0.1:9999/api/tags'],
  ]);
  assert.match(h.logs[0], /Đã có model gpt-oss:20b/);
});

test('a failed pull stops with the manual command', async () => {
  const h = harness({ failing: ['ollama'] });
  assert.equal(await h.run(), 1);
  assert.match(h.logs.at(-1), /ollama pull qwen3:14b/);
});

test('macOS uses launchctl and Linux gets systemd steps', async () => {
  const mac = harness({ platform: 'darwin' });
  assert.equal(await mac.run(), 0);
  assert.deepEqual(mac.commands.at(-1), [
    'launchctl',
    'setenv',
    'OLLAMA_CONTEXT_LENGTH',
    '32768',
  ]);
  const linux = harness({ platform: 'linux' });
  assert.equal(await linux.run(), 0);
  assert.equal(
    linux.commands.some(
      ([command]) => command === 'setx' || command === 'launchctl',
    ),
    false,
  );
  assert.match(linux.logs.join('\n'), /systemctl edit ollama\.service/);
});
