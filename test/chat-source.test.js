import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SessionChatSource, normalizeTimestamp } from '../src/chat-source.js';

test('timestamp normalization supports seconds, milliseconds, microseconds, and nanoseconds', () => {
  const ms = 1_784_204_990_395;
  assert.equal(normalizeTimestamp(ms / 1000), ms);
  assert.equal(normalizeTimestamp(ms), ms);
  assert.equal(normalizeTimestamp(ms * 1000), ms);
  assert.equal(normalizeTimestamp(ms * 1_000_000), ms);
});

test('session source primes history and only emits new messages once', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vcv-chat-test-'));
  const file = path.join(dir, 'live-session.json');
  const historical = { name: 'old', text: '!tempo 70', ts: (Date.now() - 10_000) * 1000 };
  await fs.writeFile(file, JSON.stringify({ active: true, chatHistory: [historical] }));
  const received = [];
  const source = new SessionChatSource({
    file,
    pollMs: 10_000,
    staleMs: 60_000,
    onMessage: async (message) => received.push(message),
    logger: { error() {} },
  });
  source.running = true;
  await source.poll();
  assert.equal(received.length, 0);

  const fresh = { id: 'new-1', name: 'alice', text: '!tempo 120', ts: Date.now() * 1000 };
  await fs.writeFile(file, JSON.stringify({ active: true, chatHistory: [historical, fresh] }));
  await source.poll();
  await source.processing;
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'new-1');
  assert.equal(received[0].text, '!tempo 120');

  await source.poll();
  await source.processing;
  assert.equal(received.length, 1);
  await source.close();
});

test('session source marks an abandoned active file as stale', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vcv-chat-stale-'));
  const file = path.join(dir, 'live-session.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      active: true,
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
      chatHistory: [],
    }),
  );
  const statuses = [];
  const source = new SessionChatSource({
    file,
    staleMs: 60_000,
    onMessage: async () => {},
    logger: { error() {} },
  });
  source.on('status', (status) => statuses.push(status));
  source.running = true;
  await source.poll();
  assert.equal(statuses.at(-1).active, false);
  assert.equal(statuses.at(-1).stale, true);
  assert.match(statuses.at(-1).detail, /stale/);
  await source.close();
});
