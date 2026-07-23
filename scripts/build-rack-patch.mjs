#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DEFAULT_TEMPLATE = '/mnt/c/Program Files/VCV/Rack2Free/template.vcv';
const DEFAULT_OUTPUT = path.join(root, 'patches', 'ChatRack-Live.vcv');
const DEFAULT_AUDIO_DEVICE = '';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback;
}

const templatePath = option('--template', process.env.VCV_TEMPLATE || DEFAULT_TEMPLATE);
const outputPath = option('--output', process.env.VCV_PATCH_OUTPUT || DEFAULT_OUTPUT);

const versions = Object.freeze({
  Coalescent: '2.2.1',
  Core: '2.6.6',
  CVfunk: '2.0.47',
  Fundamental: '2.6.4',
  forsitan: '2.7.0',
  'squinkylabs-plug1': '2.1.9',
  trowaSoft: '2.0.9',
});

const colors = ['#f3374b', '#ffb437', '#00b56e', '#3695ef', '#8b4ade'];
const modules = [];
const moduleByKey = new Map();
const cables = [];
let nextModuleId = 1;
let nextCableId = 1;

function paramList(values = {}) {
  return Object.entries(values)
    .map(([id, value]) => ({ id: Number(id), value }))
    .sort((a, b) => a.id - b.id);
}

function addModule(key, { plugin, model, pos, params = {}, data, left, right }) {
  if (moduleByKey.has(key)) throw new Error(`duplicate module key: ${key}`);
  const module = {
    id: nextModuleId++,
    plugin,
    model,
    version: versions[plugin],
    params: paramList(params),
    pos,
  };
  if (data !== undefined) module.data = data;
  modules.push(module);
  moduleByKey.set(key, module);
  if (left) module._left = left;
  if (right) module._right = right;
  return module;
}

function fundamental(key, model, pos, params = {}, data) {
  return addModule(key, { plugin: 'Fundamental', model, pos, params, data });
}

function cable(outputKey, outputId, inputKey, inputId) {
  const output = moduleByKey.get(outputKey);
  const input = moduleByKey.get(inputKey);
  if (!output || !input) throw new Error(`unknown cable endpoint: ${outputKey} -> ${inputKey}`);
  cables.push({
    id: nextCableId,
    outputModuleId: output.id,
    outputId,
    inputModuleId: input.id,
    inputId,
    color: colors[(nextCableId++ - 1) % colors.length],
  });
}

function oscChannel(channelNum, channelPath, input = false) {
  const value = {
    chNum: channelNum,
    path: channelPath,
    dataType: 1,
    convertVals: 0,
    clipVals: 0,
    minV: -5,
    maxV: 5,
    minOSC: 0,
    maxOSC: 1,
  };
  if (input) value.channelSensitivity = 0.005;
  return value;
}

const addresses = [
  'tempo',
  'root',
  'scale',
  'energy',
  'density',
  'brightness',
  'space',
  'chaos',
  'scene',
  'seed',
  'drums',
  'mutate',
  'drop',
  'mute',
  'freeze',
  'change',
  'panic',
  'note',
  'bass',
  'kick',
  'snare',
  'hat',
  'accent',
  'clock',
  'piano',
  'guitar',
  'synth',
];

const oscMain = addModule('oscMain', {
  plugin: 'trowaSoft',
  model: 'cvOSCcv',
  pos: [0, 0],
  params: Object.fromEntries(Array.from({ length: 39 }, (_, id) => [id, 0])),
  right: 'oscExpander',
  data: {
    version: 23,
    osc: {
      IpAddress: '127.0.0.1',
      TxPort: 7000,
      RxPort: 7001,
      Namespace: 'chat',
      AutoReconnectAtLoad: true,
      Initialized: true,
      SendFrequency: 100,
      SendChangeSensitivity: 0.005,
    },
    numCh: 8,
    inputChannels: addresses.slice(0, 8).map((name, index) => oscChannel(index + 1, `/${name}`, true)),
    outputChannels: addresses.slice(0, 8).map((name, index) => oscChannel(index + 1, `/${name}`)),
  },
});

const oscExpander = addModule('oscExpander', {
  plugin: 'trowaSoft',
  model: 'cvOSCcv-OutputExpander-16',
  pos: [26, 0],
  params: { 0: 0 },
  left: 'oscMain',
  right: 'oscInstrumentExpander',
  data: {
    version: 23,
    type: 3,
    expId: 'OCL-001',
    displayName: 'Chat channels 9-24',
    sendChangeSensitivity: -100,
    numCh: 16,
    inputChannels: [],
    outputChannels: addresses.slice(8, 24).map((name, index) => oscChannel(index + 9, `/${name}`)),
  },
});
const oscInstrumentExpander = addModule('oscInstrumentExpander', {
  plugin: 'trowaSoft',
  model: 'cvOSCcv-OutputExpander-16',
  pos: [32, 0],
  params: { 0: 0 },
  left: 'oscExpander',
  data: {
    version: 23,
    type: 3,
    expId: 'OCL-002',
    displayName: 'Chat instrument mix 25-27',
    sendChangeSensitivity: -100,
    numCh: 3,
    inputChannels: [],
    outputChannels: addresses.slice(24).map((name, index) => oscChannel(index + 25, `/${name}`)),
  },
});

// Smooth only continuous performance macros. Event gates, note pitch, drums,
// and the fail-closed master gate remain immediate.
fundamental('macroMerge', 'Merge', [38, 0]);
fundamental('macroSlew', 'Process', [43, 0], { 0: Math.log2(0.02), 1: 0 });
fundamental('macroSplit', 'Split', [48, 0]);
fundamental('noteSlew', 'Process', [53, 0], { 0: Math.log2(0.012), 1: 0 });
fundamental('bassSlew', 'Process', [58, 0], { 0: Math.log2(0.02), 1: 0 });
fundamental('constantGate', 'CVMix', [63, 0], { 0: 1, 1: 0, 2: 0 });
fundamental('chaosRandom', 'Random', [66, 0], {
  0: Math.log2(2),
  1: 0.82,
  2: 0,
  3: 0,
  4: 1,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
  9: 1,
});
fundamental('brightnessMix', 'CVMix', [75, 0], { 0: 0.33, 1: 0.12, 2: 0 });
// Slow, bounded three-phase modulation for the stereo texture. It never
// controls the clock, note pitch, or chat event gates.
addModule('operon', {
  plugin: 'Coalescent',
  model: 'Operon',
  pos: [84, 0],
  params: { 0: -8, 1: 12, 2: 2.5, 3: 1, 4: 0.05, 5: 0, 6: 0, 7: 0 },
});

// Lead voice. Scando is excited only by /note, so it stays silent until chat
// generates a musical event while retaining its own animated physical timbre.
// Interea turns the chat note into a stable three-note harmony. Chat still owns
// every pitch and trigger; this module only derives chord intervals locally.
addModule('chordInterea', {
  plugin: 'forsitan',
  model: 'interea',
  pos: [0, 1],
  params: { 0: 0, 1: 0, 2: 3, 3: 1, 4: 1 },
  data: { harmonize: false },
});
addModule('leadScando', {
  plugin: 'forsitan',
  model: 'scando',
  pos: [12, 1],
  params: {
    0: 0,
    1: 0,
    2: 0.38,
    3: 0.24,
    4: 0.6,
    5: 0.3,
    6: 0.3,
    7: 0,
    8: 0.75,
    9: 0,
    10: 0,
  },
});
fundamental('leadAdsr', 'ADSR', [28, 1], {
  0: Math.log10(5) / 4,
  1: Math.log10(180) / 4,
  2: 0,
  3: Math.log10(100) / 4,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
});
fundamental('leadEnvVca', 'VCA-1', [37, 1], { 0: 0.62, 1: 1 });
fundamental('leadAccentVca', 'VCA-1', [40, 1], { 0: 1, 1: 1 });
// A quiet third voice makes Interea's harmony audible without competing with
// Scando's physical-model lead or the bass foundation.
fundamental('chordVco', 'VCO', [44, 1], {
  0: 0, 1: 1, 2: 0, 3: 0, 4: 0, 5: 0.24, 6: 0, 7: 0,
});
fundamental('chordVca', 'VCA-1', [53, 1], { 0: 0.16, 1: 1 });

// Bass voice.
fundamental('bassVco', 'VCO', [58, 1], {
  0: 0,
  1: 1,
  2: 0,
  3: 0,
  4: 0,
  5: 0.38,
  6: 0,
  7: 0,
});
fundamental('bassAdsr', 'ADSR', [67, 1], {
  0: Math.log10(2) / 4,
  1: Math.log10(300) / 4,
  2: 0,
  3: Math.log10(120) / 4,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
});
fundamental('bassVca', 'VCA-1', [76, 1], { 0: 0.7, 1: 1 });
fundamental('synthMix', 'VCMixer', [79, 1], { 0: 0.75, 1: 0.72, 2: 0.82, 3: 0, 4: 0 }, {
  chExp: false,
  mixExp: false,
});
// Keep the chord voice under the same chat-controlled brightness filter as
// the lead and bass. This prevents the harmony layer from becoming piercing.
fundamental('preFilterMix', 'Mixer', [84, 1], { 0: 0.7 }, { average: false, invert: false });
fundamental('synthFilter', 'VCF', [88, 1], {
  0: 0.4460493384,
  1: 0,
  2: 0.16,
  3: 1,
  4: 0.03,
  5: 0,
  6: 0,
});
fundamental('heartbeatAdsr', 'ADSR', [95, 1], {
  0: 0,
  1: 0,
  2: 1,
  3: Math.log10(1000) / 4,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
});

// Percussion. /drop is deliberately ORed with /kick for a bounded impact.
fundamental('kickOrDrop', 'Logic', [0, 2], { 0: 0 });
fundamental('kickVco', 'VCO', [5, 2], {
  0: 0,
  1: 1,
  2: -27,
  3: 0,
  4: 0.1,
  5: 0.5,
  6: 0,
  7: 0,
});
fundamental('kickAdsr', 'ADSR', [14, 2], {
  0: 0,
  1: Math.log10(100) / 4,
  2: 0,
  3: Math.log10(80) / 4,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
});
fundamental('kickVca', 'VCA-1', [23, 2], { 0: 0.9, 1: 1 });
fundamental('noise', 'Noise', [26, 2]);
fundamental('snareFilter', 'VCF', [29, 2], {
  0: 0.7519387074,
  1: 0,
  2: 0.1,
  3: 0,
  4: 0,
  5: 0,
  6: 0,
});
fundamental('snareAdsr', 'ADSR', [36, 2], {
  0: 0,
  1: Math.log10(150) / 4,
  2: 0,
  3: Math.log10(100) / 4,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
});
fundamental('snareVca', 'VCA-1', [45, 2], { 0: 0.48, 1: 1 });
fundamental('hatAdsr', 'ADSR', [48, 2], {
  0: 0,
  1: Math.log10(30) / 4,
  2: 0,
  3: Math.log10(20) / 4,
  4: 0,
  5: 0,
  6: 0,
  7: 0,
  8: 0,
});
fundamental('hatVca', 'VCA-1', [57, 2], { 0: 0.26, 1: 1 });
fundamental('drumMix', 'VCMixer', [60, 2], { 0: 0.8, 1: 0.85, 2: 0.55, 3: 0.32, 4: 0 }, {
  chExp: false,
  mixExp: false,
});
fundamental('drumEnable', 'VCA-1', [69, 2], { 0: 1, 1: 1 });

// Sampled instruments. Both are deliberately restrained and go into the
// existing final mix/effects path, so chat notes add recognizable piano and
// clean guitar color without bypassing the brightness and master safeguards.
addModule('pianoSfz', {
  plugin: 'squinkylabs-plug1',
  model: 'squinkylabs-samp',
  pos: [0, 3],
  params: { 0: -1, 1: 0, 2: 0, 3: 0, 4: 22, 5: 1, 6: 1, 7: 4 },
  data: {
    schema: 2,
    sfzpath: process.env.VCV_PIANO_SFZ || '',
  },
});
addModule('guitarSfz', {
  plugin: 'squinkylabs-plug1',
  model: 'squinkylabs-samp',
  pos: [24, 3],
  params: { 0: -1, 1: 0, 2: 0, 3: 0, 4: 18, 5: 1, 6: 1, 7: 4 },
  data: {
    schema: 2,
    sfzpath: process.env.VCV_GUITAR_SFZ || '',
  },
});
fundamental('pianoEnable', 'VCA-1', [15, 3], { 0: 1, 1: 1 });
fundamental('guitarEnable', 'VCA-1', [39, 3], { 0: 1, 1: 1 });
fundamental('synthEnable', 'VCA-1', [115, 1], { 0: 1, 1: 1 });

// Mix safety and a stereo, clock-synchronized delay image.
fundamental('finalMix', 'Mixer', [72, 2], { 0: 0.42 }, { average: false, invert: false });
fundamental('delay', 'Delay', [75, 2], {
  0: Math.log10(1500) / 4,
  1: 0.32,
  2: 0.46,
  3: 0,
  4: 0,
  5: 0,
  6: 0,
  7: 0.65,
});
fundamental('stereoFade', 'Fade', [84, 2], { 0: 0.5, 1: -0.35 }, { panLaw: 1 });
addModule('haze', {
  plugin: 'CVfunk',
  model: 'Haze',
  pos: [87, 2],
  params: { 0: 0.3, 1: 0.12, 2: 0.35, 3: 0.16, 4: 0.1, 5: 0.1, 6: 0.06, 7: 0.62, 8: 0.5, 9: 0, 10: 1.45, 11: 0, 12: 0, 13: 0 },
  data: {
    hazeCutoffLow: 2000,
    hazeCutoffHigh: 10000,
    hazeApCoeff: 0.55,
    allpassMode0: false,
    allpassMode1: false,
    allpassMode2: false,
  },
});
fundamental('clipLeft', 'Compare', [95, 2], { 0: 4.8 });
fundamental('clipRight', 'Compare', [100, 2], { 0: 4.8 });
fundamental('stereoMerge', 'Merge', [105, 2]);
fundamental('masterVca', 'VCA-1', [110, 2], { 0: 1, 1: 1 });
// Exponential response turns the heartbeat envelope's one-second release into
// a near-silent fail-safe within roughly one second of lost /clock messages.
fundamental('heartbeatVca', 'VCA-1', [113, 2], { 0: 1, 1: 0 });
fundamental('stereoSplit', 'Split', [116, 2]);
addModule('audio', {
  plugin: 'Core',
  model: 'AudioInterface2',
  pos: [121, 2],
  // A modest post-limiter lift keeps the stream audible on phones and small
  // speakers while the 4.8 V safety clipper still protects the mix upstream.
  params: { 0: 1.6 },
  data: {
    audio: {
      driver: Number(process.env.VCV_AUDIO_DRIVER || 6),
      deviceName: process.env.VCV_AUDIO_DEVICE || DEFAULT_AUDIO_DEVICE,
      sampleRate: 48000,
      blockSize: 256,
      inputOffset: 0,
      outputOffset: 0,
    },
    dcFilter: true,
  },
});

// Resolve expander adjacency after all stable IDs exist.
for (const module of modules) {
  if (module._left) {
    module.leftModuleId = moduleByKey.get(module._left).id;
    delete module._left;
  }
  if (module._right) {
    module.rightModuleId = moduleByKey.get(module._right).id;
    delete module._right;
  }
}

// cvOSCcv main outputs are [TRG, VAL] pairs for channels 1-8.
cable('oscMain', 7, 'macroMerge', 0); // energy
cable('oscMain', 11, 'macroMerge', 1); // brightness
cable('oscMain', 13, 'macroMerge', 2); // space
cable('oscMain', 15, 'macroMerge', 3); // chaos
cable('macroMerge', 0, 'macroSlew', 1);
cable('macroSlew', 4, 'macroSplit', 0);

// Output expander local channels 9-15 are global channels 18-24.
cable('oscExpander', 19, 'noteSlew', 1); // /note VAL
cable('oscExpander', 21, 'bassSlew', 1); // /bass VAL
cable('oscExpander', 30, 'chaosRandom', 2); // /clock TRG
cable('oscExpander', 30, 'heartbeatAdsr', 4); // /clock TRG watchdog
cable('macroSplit', 3, 'chaosRandom', 5); // /chaos
cable('macroSplit', 1, 'brightnessMix', 0); // /brightness
cable('chaosRandom', 2, 'brightnessMix', 1);

// Constant 10V gate plus retrigger gives clean one-shot ADSR envelopes.
for (const envelope of ['leadAdsr', 'bassAdsr', 'kickAdsr', 'snareAdsr', 'hatAdsr']) {
  cable('constantGate', 0, envelope, 4);
}

// Lead.
cable('noteSlew', 4, 'chordInterea', 0);
cable('chordInterea', 0, 'leadScando', 0); // chord root
cable('oscExpander', 18, 'leadScando', 1); // /note TRG excites the string
cable('oscExpander', 18, 'leadAdsr', 5); // /note TRG
cable('leadAdsr', 0, 'leadEnvVca', 0);
cable('leadScando', 0, 'leadEnvVca', 1);
cable('oscExpander', 29, 'leadAccentVca', 0); // /accent VAL
cable('leadEnvVca', 0, 'leadAccentVca', 1);
cable('leadAccentVca', 0, 'synthMix', 1);
cable('chordInterea', 1, 'chordVco', 0); // chord third
cable('leadAdsr', 0, 'chordVca', 0);
cable('chordVco', 1, 'chordVca', 1); // triangle: softer harmonic layer

// Bass.
cable('chordInterea', 2, 'bassVco', 0); // chord fifth
cable('oscExpander', 20, 'bassAdsr', 5); // /bass TRG
cable('bassAdsr', 0, 'bassVca', 0);
cable('bassVco', 3, 'bassVca', 1); // square
cable('bassVca', 0, 'synthMix', 2);
cable('macroSplit', 0, 'synthMix', 0); // /energy
cable('synthMix', 0, 'preFilterMix', 0);
cable('chordVca', 0, 'preFilterMix', 1);
cable('preFilterMix', 0, 'synthFilter', 3);
cable('brightnessMix', 0, 'synthFilter', 0);

// Kick and drop impact.
cable('oscExpander', 22, 'kickOrDrop', 0); // /kick TRG
cable('oscExpander', 8, 'kickOrDrop', 1); // /drop TRG
cable('kickOrDrop', 2, 'kickAdsr', 5); // OR
cable('kickAdsr', 0, 'kickVco', 1);
cable('kickAdsr', 0, 'kickVca', 0);
cable('kickVco', 0, 'kickVca', 1); // sine
cable('kickVca', 0, 'drumMix', 1);

// Snare and hat.
cable('noise', 0, 'snareFilter', 3); // white
cable('oscExpander', 24, 'snareAdsr', 5); // /snare TRG
cable('snareAdsr', 0, 'snareVca', 0);
cable('snareFilter', 1, 'snareVca', 1); // high-pass
cable('snareVca', 0, 'drumMix', 2);
cable('oscExpander', 26, 'hatAdsr', 5); // /hat TRG
cable('hatAdsr', 0, 'hatVca', 0);
cable('noise', 4, 'hatVca', 1); // blue
cable('hatVca', 0, 'drumMix', 3);
cable('macroSplit', 0, 'drumMix', 0); // /energy
cable('drumMix', 0, 'drumEnable', 1);
cable('oscExpander', 5, 'drumEnable', 0); // /drums VAL

// Piano follows the chat root while guitar supplies the chord third. Accent
// sets the sampler velocity, giving messages a real dynamic response.
cable('chordInterea', 0, 'pianoSfz', 0);
cable('oscExpander', 29, 'pianoSfz', 1);
cable('oscExpander', 18, 'pianoSfz', 2);
cable('oscInstrumentExpander', 1, 'pianoEnable', 0); // /piano VAL
cable('pianoSfz', 0, 'pianoEnable', 1);
cable('pianoEnable', 0, 'finalMix', 2);
cable('chordInterea', 1, 'guitarSfz', 0);
cable('oscExpander', 29, 'guitarSfz', 1);
cable('oscExpander', 18, 'guitarSfz', 2);
cable('oscInstrumentExpander', 3, 'guitarEnable', 0); // /guitar VAL
cable('guitarSfz', 0, 'guitarEnable', 1);
cable('guitarEnable', 0, 'finalMix', 3);
cable('oscInstrumentExpander', 5, 'synthEnable', 0); // /synth VAL

// Stereo effects, safety clip, fail-closed master gate, and 48 kHz output.
cable('synthFilter', 0, 'synthEnable', 1);
cable('synthEnable', 0, 'finalMix', 0);
cable('drumEnable', 0, 'finalMix', 1);
cable('finalMix', 0, 'delay', 4);
cable('oscExpander', 30, 'delay', 5); // /clock TRG
cable('macroSplit', 2, 'delay', 3); // /space
cable('finalMix', 0, 'stereoFade', 1);
cable('delay', 0, 'stereoFade', 2);
cable('macroSplit', 2, 'stereoFade', 0); // /space
cable('stereoFade', 0, 'haze', 0);
cable('stereoFade', 1, 'haze', 1);
cable('operon', 0, 'haze', 2); // phase 1 -> rate
cable('operon', 1, 'haze', 3); // phase 2 -> depth
cable('operon', 2, 'haze', 4); // phase 3 -> haze
cable('macroSplit', 2, 'haze', 5); // /space -> wet mix
cable('haze', 0, 'clipLeft', 0);
cable('haze', 1, 'clipRight', 0);
cable('clipLeft', 2, 'stereoMerge', 0);
cable('clipRight', 2, 'stereoMerge', 1);
cable('stereoMerge', 0, 'masterVca', 1);
cable('oscExpander', 11, 'masterVca', 0); // /mute VAL: 10V live, 0V muted
cable('heartbeatAdsr', 0, 'heartbeatVca', 0);
cable('masterVca', 0, 'heartbeatVca', 1);
cable('heartbeatVca', 0, 'stereoSplit', 0);
cable('stereoSplit', 0, 'audio', 0);
cable('stereoSplit', 1, 'audio', 1);

function validatePatch(patch) {
  const ids = new Set(patch.modules.map((module) => module.id));
  if (ids.size !== patch.modules.length) throw new Error('module IDs are not unique');

  const trowaModels = patch.modules.filter((module) => module.plugin === 'trowaSoft').map((module) => module.model);
  if (trowaModels.join(',') !== 'cvOSCcv,cvOSCcv-OutputExpander-16,cvOSCcv-OutputExpander-16') {
    throw new Error(`unexpected trowaSoft modules: ${trowaModels.join(', ')}`);
  }

  const expectedThirdParty = new Map([
    ['Coalescent', ['Operon']],
    ['CVfunk', ['Haze']],
    ['forsitan', ['interea', 'scando']],
    ['squinkylabs-plug1', ['squinkylabs-samp', 'squinkylabs-samp']],
  ]);
  for (const [plugin, models] of expectedThirdParty) {
    const found = patch.modules.filter((module) => module.plugin === plugin).map((module) => module.model);
    if (found.join(',') !== models.join(',')) throw new Error(`unexpected ${plugin} modules: ${found.join(', ')}`);
    if (!versions[plugin]) throw new Error(`missing version for ${plugin}`);
  }
  if (patch.modules.length !== 54 || patch.cables.length !== 98) {
    throw new Error(`unexpected patch size: ${patch.modules.length} modules, ${patch.cables.length} cables`);
  }

  const occupiedInputs = new Set();
  for (const item of patch.cables) {
    if (!ids.has(item.outputModuleId) || !ids.has(item.inputModuleId)) throw new Error(`cable ${item.id} has a missing module`);
    const inputKey = `${item.inputModuleId}:${item.inputId}`;
    if (occupiedInputs.has(inputKey)) throw new Error(`multiple cables target input ${inputKey}`);
    occupiedInputs.add(inputKey);
  }

  if (
    oscMain.rightModuleId !== oscExpander.id ||
    oscExpander.leftModuleId !== oscMain.id ||
    oscExpander.rightModuleId !== oscInstrumentExpander.id ||
    oscInstrumentExpander.leftModuleId !== oscExpander.id
  ) {
    throw new Error('cvOSCcv expander adjacency is not reciprocal');
  }
  if (
    oscExpander.data.outputChannels.length !== 16 ||
    oscExpander.data.outputChannels.at(-1).path !== '/clock' ||
    oscInstrumentExpander.data.outputChannels.length !== 3 ||
    oscInstrumentExpander.data.outputChannels.at(-1).path !== '/synth'
  ) {
    throw new Error('OSC output expander channel contract is incomplete');
  }
}

const patch = {
  version: '2.6.6',
  path: 'ChatRack-Live.vcv',
  zoom: 0.72,
  gridOffset: [-1, -0.1],
  modules,
  cables,
};

validatePatch(patch);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr || '').trim()}`);
  return result.stdout;
}

if (!fs.existsSync(templatePath)) throw new Error(`Rack template not found: ${templatePath}`);
for (const command of ['zstd', 'tar']) execFileSync(command, ['--version'], { stdio: 'ignore' });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcv-chat-patch-'));
try {
  const templateTar = run('zstd', ['-d', '--stdout', templatePath]);
  run('tar', ['-xf', '-', '-C', tempDir], { input: templateTar });
  fs.writeFileSync(path.join(tempDir, 'patch.json'), `${JSON.stringify(patch, null, 2)}\n`);

  const archiveTar = run('tar', ['-cf', '-', '-C', tempDir, '.']);
  // Patch archives are tiny; moderate compression keeps rebuilds fast while
  // remaining fully compatible with Rack's .tar.zst patch format.
  const compressed = run('zstd', ['-q', '-6', '--stdout'], { input: archiveTar });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, compressed);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log(`Built ${outputPath}`);
console.log(`Modules: ${modules.length}; cables: ${cables.length}; OSC channels: ${addresses.length}`);
console.log('Audio 2: stereo, 48000 Hz, 256 samples (select the desired Windows output device in Rack).');
