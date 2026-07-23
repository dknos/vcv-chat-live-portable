import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_STATE } from '../src/music.js';
import { GenerativeSequencer, SCALE_INTERVALS, buildStepEvents } from '../src/sequencer.js';

test('step generation is deterministic for a state, step, and bar', () => {
  const state = { ...INITIAL_STATE, scene: 'dnb', density: 0.9, chaos: 0.5, seed: 12345 };
  assert.deepEqual(buildStepEvents(state, 7, 3), buildStepEvents(state, 7, 3));
});

test('generated pitch values remain in a safe VCV range', () => {
  for (const scale of Object.keys(SCALE_INTERVALS)) {
    const state = { ...INITIAL_STATE, scale, density: 1, chaos: 1 };
    for (let bar = 0; bar < 4; bar += 1) {
      for (let step = 0; step < 16; step += 1) {
        for (const [control, value] of buildStepEvents(state, step, bar)) {
          if (control === 'note' || control === 'bass') assert.ok(value >= -4 && value <= 4);
        }
      }
    }
  }
});

test('muted state emits clock only and drumless state emits no drums', () => {
  const muted = buildStepEvents({ ...INITIAL_STATE, muted: true }, 0, 0);
  assert.deepEqual(muted, [['clock', 1]]);
  const drumless = buildStepEvents({ ...INITIAL_STATE, drums: false, density: 1 }, 0, 0);
  assert.ok(!drumless.some(([name]) => ['kick', 'snare', 'hat'].includes(name)));
});

test('scene drum patterns produce expected anchor hits', () => {
  const house = buildStepEvents({ ...INITIAL_STATE, scene: 'house', drums: true, chaos: 0 }, 0, 0);
  assert.ok(house.some(([name]) => name === 'kick'));
  const dubstep = buildStepEvents({ ...INITIAL_STATE, scene: 'dubstep', drums: true, chaos: 0 }, 8, 0);
  assert.ok(dubstep.some(([name]) => name === 'snare'));
});

test('swing lengthens and shortens alternating sixteenth-note intervals without tempo drift', () => {
  const sequencer = new GenerativeSequencer({
    controller: { state: { ...INITIAL_STATE, tempo: 120, swing: 0.2 } },
    osc: {},
  });
  const straight = 60_000 / 120 / 4;
  assert.equal(sequencer.stepDurationMs(0), straight * 1.2);
  assert.equal(sequencer.stepDurationMs(1), straight * 0.8);
  assert.equal(sequencer.stepDurationMs(0) + sequencer.stepDurationMs(1), straight * 2);
});

test('lead and bass octave controls shift generated pitch by exact octaves', () => {
  const base = { ...INITIAL_STATE, density: 1, leadArticulation: 1, bassArticulation: 1, seed: 22 };
  const low = buildStepEvents({ ...base, leadOctave: 4, bassOctave: 1 }, 0, 0);
  const high = buildStepEvents({ ...base, leadOctave: 5, bassOctave: 2 }, 0, 0);
  const lowNote = low.find(([name]) => name === 'note')?.[1];
  const highNote = high.find(([name]) => name === 'note')?.[1];
  const lowBass = low.find(([name]) => name === 'bass')?.[1];
  const highBass = high.find(([name]) => name === 'bass')?.[1];
  assert.equal(highNote - lowNote, 1);
  assert.equal(highBass - lowBass, 1);
});
