import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractModelRequest,
  ModelClient,
  ModelControlService,
  parseModelCommands,
} from '../src/model-control.js';

test('model request accepts direct and scoped triggers', () => {
  assert.deepEqual(
    extractModelRequest('!ai make it dark and slower'),
    { ok: true, prompt: 'make it dark and slower' },
  );
  assert.deepEqual(
    extractModelRequest('!rack ai build toward a bright drop'),
    { ok: true, prompt: 'build toward a bright drop' },
  );
  assert.equal(extractModelRequest('ordinary chat'), null);
  assert.equal(extractModelRequest('!ai x').ok, false);
});

test('model output is normalized and revalidated through the music parser', () => {
  assert.deepEqual(
    parseModelCommands('```json\n{"commands":["!tempo 112","energy 80","!rack scene jungle"]}\n```'),
    ['!rack tempo 112', '!rack energy 80', '!rack scene jungle'],
  );
  assert.throws(
    () => parseModelCommands({ commands: ['!rack panic'] }),
    /disallowed command/,
  );
  assert.throws(
    () => parseModelCommands({ commands: ['!image secret diagram'] }),
    /disallowed command/,
  );
});

test('OpenAI-compatible client keeps the key in the authorization header', async () => {
  let request;
  const client = new ModelClient({
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: 'test-only-key',
    model: 'local-model',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"commands":["!rack tempo 120"]}' } }] }),
      };
    },
  });

  const result = await client.complete('steady groove', { state: { tempo: 100 } });
  assert.equal(result, '{"commands":["!rack tempo 120"]}');
  assert.equal(request.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(request.options.headers.authorization, 'Bearer test-only-key');
  assert.equal(request.options.body.includes('test-only-key'), false);
});

test('model control is owner-only and applies only validated commands', async () => {
  const applied = [];
  const activities = [];
  const service = new ModelControlService({
    enabled: true,
    ownerOnly: true,
    client: { complete: async () => ({ commands: ['tempo 126', '!energy 72'] }) },
    isTrusted: (message) => !!message.isOwner,
    getSnapshot: () => ({ state: { tempo: 100, scene: 'chill' } }),
    applyCommand: async (message) => {
      applied.push(message);
      return { status: 'queued' };
    },
    cooldownMs: 5_000,
    now: () => 10_000,
  });
  service.on('activity', (activity) => activities.push(activity));

  assert.equal(await service.submit({ id: '1', name: 'viewer', text: '!ai go faster' }), true);
  assert.equal(applied.length, 0);
  assert.equal(activities.at(-1).detail, 'owner/mod only');

  assert.equal(await service.submit({
    id: '2',
    name: 'operator',
    text: '!ai go faster',
    isOwner: true,
  }), true);
  assert.deepEqual(applied.map((message) => message.text), ['!rack tempo 126', '!rack energy 72']);
  assert.ok(applied.every((message) => message.trusted && message.isOwner));
});
