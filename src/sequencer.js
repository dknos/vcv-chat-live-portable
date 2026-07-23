import { EventEmitter } from 'node:events';

import { composePattern } from './pattern-grammar.js';

export const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix32(value) {
  value |= 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

function randomAt(seed, bar, step, lane) {
  return mix32((seed >>> 0) ^ Math.imul(bar + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b) ^ lane) / 0xffffffff;
}

function pitchVoltage(root, intervals, degree, octave) {
  const length = intervals.length;
  const wrapped = ((degree % length) + length) % length;
  const octaveCarry = Math.floor(degree / length);
  const midi = 12 * (octave + 1 + octaveCarry) + root + intervals[wrapped];
  return clamp((midi - 60) / 12, -4, 4);
}

function includesWithChaos(steps, step, chance, random) {
  if (steps.includes(step)) return true;
  return random < chance;
}

export function buildStepEvents(state, step, bar) {
  const intervals = SCALE_INTERVALS[state.scale] || SCALE_INTERVALS.minor;
  const events = [['clock', 1]];
  if (state.muted) return events;

  const pattern = composePattern(state, step, bar, {
    lead: randomAt(state.seed, bar, step, 0x101),
    bass: randomAt(state.seed, bar, step, 0x201),
    drums: randomAt(state.seed, bar, step, 0x301),
    harmony: randomAt(state.seed, bar, step, 0x401),
  });
  const pitchRoot = Number.isFinite(state.currentChordSemitone)
    ? state.root + state.currentChordSemitone
    : state.root;
  if (randomAt(state.seed, bar, step, 0x102) < pattern.leadChance) {
    events.push(['accent', clamp(2 + pattern.energy * 6 + (state.leadArticulation ?? 0.6) * 2, 0, 10)]);
    events.push(['note', pitchVoltage(pitchRoot, intervals, pattern.leadDegree, state.leadOctave ?? 5)]);
  }

  const bassPulse = step % 4 === 0 ? 1 : step % 2 === 1 ? 0.42 : 0.18;
  if (randomAt(state.seed, bar, step, 0x202) < pattern.bassChance * bassPulse) {
    events.push(['bass', pitchVoltage(pitchRoot, intervals, pattern.bassDegree, state.bassOctave ?? 2)]);
  }

  if (state.drums && pattern.drumLevel > 0.01) {
    if (pattern.rhythm.kick) events.push(['kick', 1]);
    if (pattern.rhythm.snare) events.push(['snare', 1]);
    if (pattern.rhythm.hat) events.push(['hat', 1]);
  }
  return events;
}

export class GenerativeSequencer extends EventEmitter {
  constructor({ controller, osc, now = () => performance.now(), logger = console }) {
    super();
    this.controller = controller;
    this.osc = osc;
    this.now = now;
    this.logger = logger;
    this.step = 0;
    this.bar = 0;
    this.nextAt = 0;
    this.timer = null;
    this.running = false;
    this.busy = false;
  }

  stepDurationMs(step = this.step) {
    const base = 60_000 / clamp(this.controller.state.tempo, 60, 180) / 4;
    const swing = clamp(this.controller.state.swing ?? 0, 0, 0.5);
    return base * (step % 2 === 0 ? 1 + swing : 1 - swing);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextAt = this.now() + 100;
    this.schedule();
    this.logger.log('[sequencer] generative 16-step engine ready');
  }

  schedule() {
    if (!this.running) return;
    const delay = Math.max(0, this.nextAt - this.now());
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  async tick() {
    if (!this.running || this.busy) return;
    this.busy = true;
    try {
      const events = buildStepEvents(this.controller.state, this.step, this.bar);
      await this.osc.sendMany(events);
      this.emit('step', { step: this.step, bar: this.bar, events });
      this.step += 1;
      if (this.step >= 16) {
        this.step = 0;
        this.bar += 1;
      }
      this.nextAt += this.stepDurationMs(this.step - 1 < 0 ? 15 : this.step - 1);
      const now = this.now();
      if (this.nextAt < now - this.stepDurationMs() * 2) this.nextAt = now + this.stepDurationMs();
    } catch (error) {
      this.logger.error(`[sequencer] ${error.message}`);
      this.nextAt = this.now() + this.stepDurationMs();
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export const __test = { clamp, mix32, randomAt, pitchVoltage, includesWithChaos };
