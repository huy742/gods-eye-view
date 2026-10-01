#!/usr/bin/env node
// One-time setup for the chat panel's "AI local" mode. Checks that Ollama is
// installed and running, pulls the model, and raises Ollama's context window
// so the app's ~14K-token instructions and tools fit (Ollama defaults to 4096).
// The model loads into VRAM only when AI local gets its first message.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { projectRoot } from './project-root.mjs';
import {
  OLLAMA_BASE_URL_DEFAULT,
  OLLAMA_MODEL_DEFAULT,
} from '../server/providers/claude-chat.js';

export const LOCAL_AI_CONTEXT_LENGTH = 32768;

/** Run the setup steps; returns the process exit code. */
export async function setupLocalAi({
  env,
  platform = process.platform,
  run = (command, args) => spawnSync(command, args, { stdio: 'inherit' }),
  probe = (command, args) => spawnSync(command, args, { encoding: 'utf8' }),
  fetchImpl = (...args) => fetch(...args),
  log = console.log,
}) {
  const model = String(env.OLLAMA_MODEL || '').trim() || OLLAMA_MODEL_DEFAULT;
  const baseURL = (
    String(env.OLLAMA_BASE_URL || '').trim() || OLLAMA_BASE_URL_DEFAULT
  ).replace(/\/+$/, '');
  const ok = (result) => !result.error && result.status === 0;

  if (!ok(probe('ollama', ['--version']))) {
    log(
      'Chưa cài Ollama. Tải bản cài ở https://ollama.com/download, cài xong mở Ollama rồi chạy lại: npm run setup:local-ai',
    );
    return 1;
  }

  let models;
  try {
    const response = await fetchImpl(`${baseURL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    ({ models = [] } = await response.json());
  } catch {
    log(
      `Ollama đã cài nhưng chưa chạy ở ${baseURL}. Mở ứng dụng Ollama (hoặc chạy "ollama serve") rồi chạy lại lệnh này.`,
    );
    return 1;
  }

  const names = models.flatMap((entry) => [entry?.name, entry?.model]);
  if (
    names.includes(model) ||
    (!model.includes(':') && names.includes(`${model}:latest`))
  ) {
    log(`Đã có model ${model}.`);
  } else {
    log(`Đang tải model ${model} (vài GB, lâu hay nhanh tuỳ mạng)...`);
    if (!ok(run('ollama', ['pull', model]))) {
      log(`Tải ${model} thất bại. Thử chạy tay: ollama pull ${model}`);
      return 1;
    }
  }

  const value = String(LOCAL_AI_CONTEXT_LENGTH);
  if (Number(env.OLLAMA_CONTEXT_LENGTH) >= LOCAL_AI_CONTEXT_LENGTH) {
    log(`OLLAMA_CONTEXT_LENGTH=${env.OLLAMA_CONTEXT_LENGTH}: đủ dài.`);
  } else if (platform === 'win32') {
    // Ollama on Windows reads the user's environment variables at start.
    if (ok(run('setx', ['OLLAMA_CONTEXT_LENGTH', value])))
      log(
        `Đã đặt OLLAMA_CONTEXT_LENGTH=${value} cho tài khoản Windows. Thoát Ollama ở khay hệ thống (góc phải thanh taskbar) rồi mở lại để áp dụng.`,
      );
    else
      log(
        `Không đặt được biến. Tự đặt OLLAMA_CONTEXT_LENGTH=${value} trong "Edit environment variables for your account", rồi mở lại Ollama.`,
      );
  } else if (platform === 'darwin') {
    if (ok(run('launchctl', ['setenv', 'OLLAMA_CONTEXT_LENGTH', value])))
      log(
        `Đã đặt OLLAMA_CONTEXT_LENGTH=${value}. Thoát rồi mở lại ứng dụng Ollama. Sau khi khởi động lại máy, chạy lại lệnh này.`,
      );
    else
      log(
        `Không đặt được biến. Chạy: launchctl setenv OLLAMA_CONTEXT_LENGTH ${value}, rồi mở lại Ollama.`,
      );
  } else {
    log(
      [
        `Trên Linux, đặt OLLAMA_CONTEXT_LENGTH=${value} cho dịch vụ Ollama:`,
        '  sudo systemctl edit ollama.service',
        `  thêm dưới [Service]: Environment="OLLAMA_CONTEXT_LENGTH=${value}"`,
        '  sudo systemctl daemon-reload && sudo systemctl restart ollama',
      ].join('\n'),
    );
  }

  log(
    'Xong. Trong app, bấm "Chat AI" rồi chọn "AI local" hoặc "Miễn phí: Gemini → AI local". Model chỉ được nạp vào VRAM khi AI local nhận tin đầu tiên; Ollama tự nhả sau 5 phút không dùng.',
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const file = path.join(projectRoot(import.meta.url), '.env');
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  process.exitCode = await setupLocalAi({
    env: { ...fromFile, ...process.env },
  });
}
