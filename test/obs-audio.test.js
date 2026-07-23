import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { normalizeMeterLevel, obsAuthentication } from '../src/obs-audio.js';

test('OBS authentication follows the challenge hash sequence', () => {
  const password = 'local-secret', salt = 'salt', challenge = 'challenge';
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  const expected = crypto.createHash('sha256').update(secret + challenge).digest('base64');
  assert.equal(obsAuthentication(password, salt, challenge), expected);
});

test('meter normalization gives guitar-friendly headroom', () => {
  assert.equal(normalizeMeterLevel(0), 0);
  assert.ok(normalizeMeterLevel(0.1) > 0.7);
  assert.equal(normalizeMeterLevel(1), 1);
});
