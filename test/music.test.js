import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INITIAL_STATE,
  MusicController,
  ROOTS,
  SCALES,
  parseChatCommand,
  stateToOscValues,
  vibeToChanges,
} from '../src/music.js';

test('parser ignores ordinary chat and accepts scoped or direct commands', () => {
  assert.deepEqual(parseChatCommand('nice patch'), { matched: false });
  assert.equal(parseChatCommand('!rack tempo 126').action.changes.tempo, 126);
  assert.equal(parseChatCommand('!tempo 127').action.changes.tempo, 127);
  assert.deepEqual(parseChatCommand('!tempo 127', { directAliases: false }), { matched: false });
  assert.deepEqual(parseChatCommand('!rackety tempo 127'), { matched: false });
});

test('parser validates bounded numeric commands', () => {
  assert.equal(parseChatCommand('!energy 75').action.changes.energy, 0.75);
  assert.equal(parseChatCommand('!space 0.4').action.changes.space, 0.4);
  assert.equal(parseChatCommand('!chaos 25%').action.changes.chaos, 0.25);
  assert.equal(parseChatCommand('!tempo 20').ok, false);
  assert.equal(parseChatCommand('!density 500').ok, false);
  assert.equal(parseChatCommand('!brightness banana').ok, false);
  assert.equal(parseChatCommand('!swing 24').action.changes.swing, 0.24);
  assert.equal(parseChatCommand('!swing 70').ok, false);
});

test('parser exposes harmony, arrangement, articulation, mix, and lane mutation controls', () => {
  assert.deepEqual(parseChatCommand('!chords i VI III VII').action.changes.chordProgression, [0, 5, 2, 6]);
  assert.equal(parseChatCommand('!phrase 8').action.changes.phraseLength, 8);
  assert.equal(parseChatCommand('!octave bass 1').action.changes.bassOctave, 1);
  assert.equal(parseChatCommand('!articulation lead 65').action.changes.leadArticulation, 0.65);
  assert.deepEqual(parseChatCommand('!mix piano 60').action.changes, { pianoMix: 0.6, piano: true });
  assert.deepEqual(parseChatCommand('!mutate drums 35').action.changes, { mutation: { drums: 0.35 } });
  assert.equal(parseChatCommand('!section build').action.changes.section, 'build');
});

test('instrument commands independently add and remove the sampled voices', () => {
  assert.deepEqual(parseChatCommand('!add piano').action.changes, { piano: true });
  assert.deepEqual(parseChatCommand('!remove piano').action.changes, { piano: false });
  assert.deepEqual(parseChatCommand('!add electric guitar').action.changes, { guitar: true });
  assert.deepEqual(parseChatCommand('!remove guitar').action.changes, { guitar: false });
  assert.equal(parseChatCommand('!add saxophone').ok, false);
});

test('key and scale parsing handles musical aliases', () => {
  const flat = parseChatCommand('!key Db minor').action.changes;
  assert.equal(ROOTS[flat.root], 'C#');
  assert.equal(flat.scale, 'minor');
  const compact = parseChatCommand('!key Bbm').action.changes;
  assert.equal(ROOTS[compact.root], 'Bb');
  assert.equal(compact.scale, 'minor');
  assert.equal(parseChatCommand('!scale ionian').action.changes.scale, 'major');
  assert.equal(parseChatCommand('!scale imaginary').ok, false);
});

test('scale cycle uses a bounded jazz palette and can be stopped', () => {
  const cycle = parseChatCommand('!scale cycle 4').action.changes;
  assert.equal(cycle.scaleCycleEnabled, true);
  assert.equal(cycle.scaleCycleBars, 4);
  assert.deepEqual(cycle.scaleCyclePalette, ['dorian', 'mixolydian', 'lydian', 'major', 'minor']);
  assert.equal(parseChatCommand('!scale stop').action.changes.scaleCycleEnabled, false);
});

test('vibe generation is deterministic and remains bounded', () => {
  const first = vibeToChanges('dark underwater jungle with no drums');
  const second = vibeToChanges('dark underwater jungle with no drums');
  assert.deepEqual(first, second);
  assert.equal(first.scene, 'jungle');
  assert.equal(first.scale, 'phrygian');
  assert.equal(first.drums, false);
  for (const field of ['energy', 'density', 'brightness', 'space', 'chaos']) {
    assert.ok(first[field] >= 0 && first[field] <= 1, `${field} was ${first[field]}`);
  }
});

test('state OSC mapping is always 0-10V', () => {
  const values = stateToOscValues({ ...INITIAL_STATE, tempo: 180, root: 11, scale: SCALES.at(-1) });
  for (const [name, value] of Object.entries(values)) {
    assert.ok(value >= 0 && value <= 10, `${name} was ${value}`);
  }
  assert.equal(values.tempo, 10);
  assert.equal(values.root, 10);
  assert.equal(values.scale, 10);
  assert.equal(values.mute, 10);
  assert.equal(stateToOscValues({ ...INITIAL_STATE, muted: true }).mute, 0);
});

function makeConfig(overrides = {}) {
  return {
    commands: {
      prefix: '!rack',
      directAliases: true,
      perUserCooldownMs: 3000,
      globalCooldownMs: 350,
      maxActionsPerBar: 8,
      trustedChannelIds: new Set(['owner-id']),
      trustedDisplayNames: new Set(),
      ...overrides.commands,
    },
    scheduler: {
      quantizeBars: true,
      beatsPerBar: 4,
      tickMs: 25,
      ...overrides.scheduler,
    },
  };
}

class FakeOsc {
  constructor() {
    this.sent = [];
  }
  async send(control, value) {
    this.sent.push([control, value]);
  }
  async sendMany(entries) {
    for (const entry of entries) await this.send(...entry);
  }
}

test('controller queues audience changes and applies them at a bar boundary', async () => {
  let now = 1_000_000;
  const osc = new FakeOsc();
  const controller = new MusicController({ config: makeConfig(), osc, now: () => now });
  const result = await controller.submit({ name: 'alice', text: '!tempo 128' });
  assert.equal(result.status, 'queued');
  assert.equal(controller.state.tempo, INITIAL_STATE.tempo);
  assert.equal(controller.pending.length, 1);
  now = controller.nextBarAt;
  await controller.tick(now);
  assert.equal(controller.state.tempo, 128);
  assert.equal(controller.pending.length, 0);
  assert.ok(osc.sent.some(([name]) => name === 'tempo'));
  assert.ok(osc.sent.some(([name]) => name === 'change'));
});

test('scale cycle changes only at its requested phrase boundary', async () => {
  let now = 1_000_000;
  const osc = new FakeOsc();
  const controller = new MusicController({ config: makeConfig(), osc, now: () => now });
  await controller.submit({ name: 'alice', text: '!scale cycle 4' });
  for (let bar = 0; bar < 3; bar += 1) {
    now = controller.nextBarAt;
    await controller.tick(now);
  }
  assert.equal(controller.state.scale, 'minor');
  now = controller.nextBarAt;
  await controller.tick(now);
  assert.equal(controller.state.scale, 'dorian');
  assert.ok(osc.sent.some(([name]) => name === 'scale'));
});

test('controller enforces cooldowns and privileged safety controls', async () => {
  let now = 1_000_000;
  const osc = new FakeOsc();
  const controller = new MusicController({
    config: makeConfig({ scheduler: { quantizeBars: false } }),
    osc,
    now: () => now,
  });
  assert.equal((await controller.submit({ name: 'alice', text: '!energy 70' })).status, 'applied');
  now += 100;
  assert.equal((await controller.submit({ name: 'alice', text: '!space 50' })).status, 'rejected');
  assert.equal((await controller.submit({ name: 'alice', text: '!rack panic' })).status, 'rejected');
  assert.equal(
    (await controller.submit({ name: 'owner', channelId: 'owner-id', text: '!rack panic' })).status,
    'applied',
  );
  assert.equal(controller.state.muted, true);
  assert.equal(controller.state.frozen, true);
  assert.ok(osc.sent.some(([name, value]) => name === 'mute' && value === 0));
  assert.ok(osc.sent.some(([name, value]) => name === 'freeze' && value === 10));
  assert.ok(osc.sent.some(([name]) => name === 'panic'));
});

test('frozen controller rejects viewers but permits owner recovery', async () => {
  let now = 1_000_000;
  const controller = new MusicController({
    config: makeConfig({ scheduler: { quantizeBars: false } }),
    osc: new FakeOsc(),
    now: () => now,
  });
  await controller.submit({ name: 'owner', channelId: 'owner-id', text: '!rack freeze' });
  now += 10_000;
  assert.equal((await controller.submit({ name: 'bob', text: '!tempo 140' })).status, 'rejected');
  assert.equal(
    (await controller.submit({ name: 'owner', channelId: 'owner-id', text: '!rack unfreeze' })).status,
    'applied',
  );
  assert.equal(controller.state.frozen, false);
});
