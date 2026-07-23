import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

test('configuration is safe and local by default', () => {
  const config = loadConfig({ HOME: '/tmp/test-home' });
  assert.equal(config.chat.source, 'session');
  assert.equal(config.osc.host, '127.0.0.1');
  assert.equal(config.overlay.host, '127.0.0.1');
  assert.equal(config.scheduler.quantizeBars, true);
  assert.equal(config.model.enabled, false);
  assert.equal(config.model.ownerOnly, true);
  assert.equal(config.model.provider, 'openai-compatible');
});

test('configuration rejects invalid ranges and parses trusted IDs', () => {
  assert.throws(() => loadConfig({ OSC_PORT: '99999' }), /OSC_PORT/);
  const config = loadConfig({
    TRUSTED_CHANNEL_IDS: 'abc, def',
    TRUSTED_DISPLAY_NAMES: 'Alice, @Mod',
    QUANTIZE_BARS: '0',
  });
  assert.deepEqual([...config.commands.trustedChannelIds], ['abc', 'def']);
  assert.ok(config.commands.trustedDisplayNames.has('alice'));
  assert.equal(config.scheduler.quantizeBars, false);
});

test('model provider configuration is environment swappable without embedded credentials', () => {
  const config = loadConfig({
    MODEL_CONTROL_ENABLED: '1',
    MODEL_PROVIDER: 'anthropic',
    MODEL_BASE_URL: 'https://api.anthropic.com/v1/',
    MODEL_API_KEY: 'runtime-only',
    MODEL_NAME: 'example-model',
    MODEL_MAX_COMMANDS: '3',
  });
  assert.equal(config.model.enabled, true);
  assert.equal(config.model.provider, 'anthropic');
  assert.equal(config.model.baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(config.model.apiKey, 'runtime-only');
  assert.equal(config.model.name, 'example-model');
  assert.equal(config.model.maxCommands, 3);
  assert.throws(
    () => loadConfig({ MODEL_PROVIDER: 'unknown' }),
    /MODEL_PROVIDER/,
  );
  assert.throws(
    () => loadConfig({ MODEL_BASE_URL: 'file:\/\/secret' }),
    /MODEL_BASE_URL/,
  );
});
