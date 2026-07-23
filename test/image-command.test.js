import assert from 'node:assert/strict';
import test from 'node:test';
import { __test } from '../src/image-command.js';

test('image command accepts direct and scoped prompts but rejects links', () => {
  assert.deepEqual(__test.extractImagePrompt('!image cat playing a banjo'), { ok: true, prompt: 'cat playing a banjo' });
  assert.deepEqual(__test.extractImagePrompt('!rack image neon jellyfish'), { ok: true, prompt: 'neon jellyfish' });
  assert.equal(__test.extractImagePrompt('!image https://example.com/cat.png').ok, false);
  assert.equal(__test.extractImagePrompt('!image no').ok, false);
  assert.equal(__test.extractImagePrompt('ordinary chat'), null);
});

test('image output parser keeps only absolute image paths', () => {
  assert.deepEqual(__test.imagePaths('saved /tmp/a.png\nother /tmp/b.webp'), ['/tmp/a.png', '/tmp/b.webp']);
});

test('accelerate command is available as a direct or scoped image control', () => {
  assert.equal(__test.isAccelerateCommand('!accelerate', '!rack'), true);
  assert.equal(__test.isAccelerateCommand('!rack accelerate', '!rack'), true);
  assert.equal(__test.isAccelerateCommand('!accelerated', '!rack'), false);
});
