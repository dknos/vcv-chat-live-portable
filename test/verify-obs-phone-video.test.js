import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeObsAuthentication,
  parseArgs,
  parseScreenshotDataUrl,
  validateFramePair,
} from '../scripts/verify-obs-phone-video.mjs';

test('OBS phone verifier parses only explicit local inputs', () => {
  assert.deepEqual(parseArgs(['--config', 'config.json']), {
    configFile: 'config.json',
    sourceName: 'DroidCam Phone',
    sceneName: 'Phone Live',
  });
  assert.throws(() => parseArgs([]), /--config is required/);
  assert.throws(() => parseArgs(['--config', 'a', '--config', 'b']), /duplicate/);
  assert.throws(() => parseArgs(['--password', 'secret']), /unknown argument/);
});

test('OBS WebSocket authentication matches the protocol challenge formula', () => {
  assert.equal(
    computeObsAuthentication('password', 'salt', 'challenge'),
    'zTM5ki6L2vVvBQiTG9ckH1Lh64AbnCf6XZ226UmnkIA=',
  );
});

test('phone frames must be valid, substantial, and changing', () => {
  const first = Buffer.alloc(4096, 1);
  const second = Buffer.alloc(4096, 2);
  const dataUrl = `data:image/png;base64,${first.toString('base64')}`;
  assert.deepEqual(parseScreenshotDataUrl(dataUrl), first);
  assert.deepEqual(validateFramePair(first, second), { bytes: 4096, fresh: true });
  assert.throws(() => validateFramePair(first, Buffer.from(first)), /fresh frame/);
  assert.throws(() => validateFramePair(Buffer.alloc(16), Buffer.alloc(16, 2)), /blank or too small/);
  assert.throws(() => parseScreenshotDataUrl('https://example.com/frame.png'), /invalid/);
});
