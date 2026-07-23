import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { OverlayServer } from '../src/overlay.js';

test('overlay serves local GPU vision assets and reports the active renderer', async (t) => {
  const server = new OverlayServer({
    host: '127.0.0.1',
    port: 0,
    htmlPath: path.resolve('public/overlay.html'),
    getSnapshot: () => ({}),
    logger: { log() {}, warn() {} },
  });
  await server.start();
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.server.address().port}`;

  for (const [asset, type] of [
    ['/gpu-hand-tracker.mjs', 'text/javascript'],
    ['/vendor/mediapipe/vision_bundle.mjs', 'text/javascript'],
    ['/vendor/mediapipe/wasm/vision_wasm_internal.wasm', 'application/wasm'],
    ['/models/hand_landmarker.task', 'application/octet-stream'],
    ['/models/pose_landmarker_lite.task', 'application/octet-stream'],
    ['/models/face_landmarker.task', 'application/octet-stream'],
  ]) {
    const response = await fetch(`${origin}${asset}`, { method: 'HEAD' });
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('content-type'), new RegExp(type));
    assert.ok(Number(response.headers.get('content-length')) > 1000);
  }

  const report = await fetch(`${origin}/tracker-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'GPU',
      renderer: 'ANGLE (NVIDIA GeForce RTX)',
      features: 'hand + pose landmarks',
    }),
  });
  assert.equal(report.status, 200);
  const health = await fetch(`${origin}/healthz`).then((response) => response.json());
  assert.deepEqual(health.status.tracking, {
    ok: true,
    mode: 'GPU',
    renderer: 'ANGLE (NVIDIA GeForce RTX)',
    features: 'hand + pose landmarks',
    detail: 'GPU hand + pose landmarks on ANGLE (NVIDIA GeForce RTX)',
  });
});
