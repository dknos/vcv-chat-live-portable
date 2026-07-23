#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, ['src/main.js'], {
  cwd: root,
  env: {
    ...process.env,
    CHAT_SOURCE: 'stdin',
    DRY_RUN: '1',
    QUANTIZE_BARS: '0',
    OVERLAY_PORT: process.env.OVERLAY_PORT || '19392',
  },
  stdio: ['pipe', 'inherit', 'inherit'],
});

const lines = [
  'alice> !vibe dark underwater jungle',
  'bob> !tempo 128',
  'carol> !key F# minor',
  'dave> !energy 82',
  'eve> !drop',
  'operator> !rack mute',
  'operator> !rack unmute',
];

let index = 0;
const timer = setInterval(() => {
  if (index < lines.length) {
    child.stdin.write(`${lines[index++]}\n`);
    return;
  }
  clearInterval(timer);
  setTimeout(() => child.kill('SIGTERM'), 350);
}, 180);

child.once('exit', (code, signal) => {
  if (code && signal !== 'SIGTERM') process.exitCode = code;
});
