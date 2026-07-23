#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DEFAULT_SOURCE = path.join(root, 'patches', 'ChatRack-Live.vcv');
const DEFAULT_OUTPUT = path.join(root, 'patches', 'Doom-Jazz-Machine.vcv');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : fallback;
}

const sourcePath = option('--source', process.env.VCV_DOOM_SOURCE || DEFAULT_SOURCE);
const outputPath = option('--output', process.env.VCV_DOOM_OUTPUT || DEFAULT_OUTPUT);

const colors = ['#f3374b', '#ffb437', '#00b56e', '#3695ef', '#8b4ade'];
const expectedOscPaths = [
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
].map((name) => `/${name}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr || '').trim()}`);
  return result.stdout;
}

function paramList(values = {}) {
  return Object.entries(values)
    .map(([id, value]) => ({ id: Number(id), value }))
    .sort((a, b) => a.id - b.id);
}

function assertModule(patch, id, plugin, model) {
  const module = patch.modules.find((item) => item.id === id);
  if (!module || module.plugin !== plugin || module.model !== model) {
    throw new Error(`base patch module ${id} is not ${plugin}/${model}`);
  }
  return module;
}

function setParams(module, values) {
  const params = new Map((module.params || []).map((item) => [item.id, item.value]));
  for (const [id, value] of Object.entries(values)) params.set(Number(id), value);
  module.params = [...params.entries()]
    .map(([id, value]) => ({ id, value }))
    .sort((a, b) => a.id - b.id);
}

if (!fs.existsSync(sourcePath)) throw new Error(`source Rack patch not found: ${sourcePath}`);
for (const command of ['zstd', 'tar']) execFileSync(command, ['--version'], { stdio: 'ignore' });

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcv-doom-jazz-'));
try {
  const sourceTar = run('zstd', ['-d', '--stdout', sourcePath]);
  run('tar', ['-xf', '-', '-C', tempDir], { input: sourceTar });

  const patchFile = path.join(tempDir, 'patch.json');
  const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
  if (patch.modules?.length !== 54 || patch.cables?.length !== 98) {
    throw new Error(`unexpected base patch size: ${patch.modules?.length} modules, ${patch.cables?.length} cables`);
  }

  // Stable IDs from the canonical ChatRack builder. Asserting every touched
  // module prevents a future base-patch reordering from silently miswiring the
  // Doom Jazz variant.
  const macroSplit = assertModule(patch, 6, 'Fundamental', 'Split');
  const bassSlew = assertModule(patch, 8, 'Fundamental', 'Process');
  const operon = assertModule(patch, 12, 'Coalescent', 'Operon');
  const leadScando = assertModule(patch, 14, 'forsitan', 'scando');
  const chordVco = assertModule(patch, 18, 'Fundamental', 'VCO');
  const chordVca = assertModule(patch, 19, 'Fundamental', 'VCA-1');
  const bassVco = assertModule(patch, 20, 'Fundamental', 'VCO');
  const bassAdsr = assertModule(patch, 21, 'Fundamental', 'ADSR');
  const bassVca = assertModule(patch, 22, 'Fundamental', 'VCA-1');
  const synthMix = assertModule(patch, 23, 'Fundamental', 'VCMixer');
  const synthFilter = assertModule(patch, 25, 'Fundamental', 'VCF');
  const kickVco = assertModule(patch, 28, 'Fundamental', 'VCO');
  const kickAdsr = assertModule(patch, 29, 'Fundamental', 'ADSR');
  const kickVca = assertModule(patch, 30, 'Fundamental', 'VCA-1');
  const snareAdsr = assertModule(patch, 33, 'Fundamental', 'ADSR');
  const snareVca = assertModule(patch, 34, 'Fundamental', 'VCA-1');
  const hatAdsr = assertModule(patch, 35, 'Fundamental', 'ADSR');
  const hatVca = assertModule(patch, 36, 'Fundamental', 'VCA-1');
  const drumMix = assertModule(patch, 37, 'Fundamental', 'VCMixer');
  const finalMix = assertModule(patch, 44, 'Fundamental', 'Mixer');
  const stereoFade = assertModule(patch, 46, 'Fundamental', 'Fade');
  const haze = assertModule(patch, 47, 'CVfunk', 'Haze');
  const clipLeft = assertModule(patch, 48, 'Fundamental', 'Compare');
  const clipRight = assertModule(patch, 49, 'Fundamental', 'Compare');
  const stereoMerge = assertModule(patch, 50, 'Fundamental', 'Merge');
  const masterVca = assertModule(patch, 51, 'Fundamental', 'VCA-1');
  const heartbeatVca = assertModule(patch, 52, 'Fundamental', 'VCA-1');
  const stereoSplit = assertModule(patch, 53, 'Fundamental', 'Split');
  const audio = assertModule(patch, 54, 'Core', 'AudioInterface2');

  patch.path = 'Doom-Jazz-Machine.vcv';
  patch.zoom = 0.62;
  patch.gridOffset = [-1, -0.2];

  // Darker, slower core voices. Piano and guitar remain available through the
  // same /piano and /guitar mix channels, while Scando keeps the expressive
  // chat solo behavior that worked in the melodic patch.
  setParams(leadScando, {
    0: -1,
    2: 0.72,
    3: 0.16,
    4: 0.76,
    5: 0.14,
    6: 0.18,
    7: 0.05,
    8: 0.46,
  });
  setParams(chordVco, { 2: -12, 5: 0.38 });
  setParams(chordVca, { 0: 0.11 });
  setParams(bassVco, { 2: -12, 5: 0.44 });
  setParams(bassAdsr, {
    0: Math.log10(8) / 4,
    1: Math.log10(520) / 4,
    2: 0,
    3: Math.log10(240) / 4,
  });
  setParams(bassVca, { 0: 0.76 });
  setParams(synthMix, { 0: 0.7, 1: 0.56, 2: 0.94, 3: 0 });
  setParams(synthFilter, { 0: 0.36, 2: 0.28, 4: 0.42 });

  // Slow, chesty drums with restrained high-frequency energy.
  setParams(kickVco, { 2: -32, 4: 0.13 });
  setParams(kickAdsr, {
    1: Math.log10(210) / 4,
    3: Math.log10(150) / 4,
  });
  setParams(kickVca, { 0: 0.84 });
  setParams(snareAdsr, {
    1: Math.log10(230) / 4,
    3: Math.log10(180) / 4,
  });
  setParams(snareVca, { 0: 0.37 });
  setParams(hatAdsr, {
    1: Math.log10(45) / 4,
    3: Math.log10(32) / 4,
  });
  setParams(hatVca, { 0: 0.15 });
  setParams(drumMix, { 0: 0.72, 1: 0.9, 2: 0.7, 3: 0.34 });
  setParams(finalMix, { 0: 0.34 });

  // Final safety remains conservative even though the upstream sound is more
  // saturated. The limiter, mute gate, heartbeat watchdog, and DC filter are
  // inherited unchanged.
  setParams(haze, { 7: 0.46, 10: 1.08 });
  setParams(clipLeft, { 0: 4.6 });
  setParams(clipRight, { 0: 4.6 });
  setParams(audio, { 0: 1.4 });

  let nextModuleId = Math.max(...patch.modules.map((module) => module.id)) + 1;
  function addModule({ plugin, model, version, pos, params = {}, data }) {
    const module = {
      id: nextModuleId++,
      plugin,
      model,
      version,
      params: paramList(params),
      pos,
    };
    if (data !== undefined) module.data = data;
    patch.modules.push(module);
    return module;
  }

  // A four-oscillator voice replaces the screenshot's Instruo oscillator bank.
  // Focalor's "engine room" algorithm provides weight; explicit root, fifth,
  // sub, and octave tuning keeps it musically tied to the bridge's /bass CV.
  const elemental = addModule({
    plugin: 'EternalEclipseModular',
    model: 'ElementalRevelator',
    version: '2.7.1',
    pos: [48, 3],
    params: {
      0: -12,
      1: -5,
      2: -24,
      3: 0,
      4: 0.16,
      5: 0.42,
      6: 0.71,
      7: 0.88,
      8: 1,
      9: 0,
      10: 0.64,
      11: -0.38,
      12: 0.72,
      13: 0.28,
      14: 40,
      15: 13,
      16: 0.62,
      17: 0.34,
      18: 0.18,
      19: 0.55,
      20: 0.17,
      21: 1,
      22: 0.18,
      23: 0,
      24: 0,
      25: 0,
      26: 0,
      27: 0.7,
      28: 0,
      29: 0,
      30: 0,
      31: 0,
      32: 0,
      33: 0,
      34: 0,
      35: 0.12,
      36: 0,
    },
  });

  const doomVca = addModule({
    plugin: 'Fundamental',
    model: 'VCA',
    version: '2.6.4',
    pos: [90, 3],
    params: { 0: 0.7, 1: 0.7 },
  });

  // Pressed Duck stands in for the screenshot's Zod/Dimit dynamics row. The
  // kick drives its sidechain but is not re-added, producing a physical pulse
  // without doubling the drum level.
  const pressedDuck = addModule({
    plugin: 'CVfunk',
    model: 'PressedDuck',
    version: '2.0.47',
    pos: [0, 4],
    params: {
      0: 0.88,
      1: 0.72,
      2: 1,
      3: 1,
      4: 1,
      5: 1,
      6: 0,
      7: 0,
      8: 0,
      9: 0,
      10: 0,
      11: 0,
      12: 0.9,
      13: 0.36,
      14: 0,
      15: 0.58,
      16: 0,
      17: 0.72,
      18: 0,
      19: 0.2,
      20: 0,
      21: 0,
      22: 0,
      23: 0,
      24: 0,
      25: 0,
      26: 0,
      27: 0,
    },
    data: {
      applyFilters: true,
      isSupersamplingEnabled: true,
      mutedSideDucks: true,
      muteCVToggle: true,
      transitionTime: 10,
      muteLatch: [false, false, false, false, false, false, false],
      muteState: [false, false, false, false, false, false, true],
      fadeLevel: [1, 1, 1, 1, 1, 1, 0],
      transitionCount: [0, 0, 0, 0, 0, 0, 0],
    },
  });

  const moonDrive = addModule({
    plugin: 'EternalEclipseModular',
    model: 'MoonPhaseDistortion',
    version: '2.7.1',
    pos: [25, 4],
    params: { 0: 0.5, 1: 0.68, 2: 0.46, 3: 0 },
  });

  const liminal = addModule({
    plugin: 'EternalEclipseModular',
    model: 'LiminalVast',
    version: '2.7.1',
    pos: [34, 4],
    params: {
      0: 0.78,
      1: 0.68,
      2: 0.84,
      3: 0.18,
      4: 0.32,
      5: 65,
      6: 0.38,
      7: 0.56,
      8: 0.12,
    },
  });

  // Lay the new stereo mastering row out as one readable machine.
  haze.pos = [47, 4];
  clipLeft.pos = [63, 4];
  clipRight.pos = [68, 4];
  stereoMerge.pos = [73, 4];
  masterVca.pos = [78, 4];
  heartbeatVca.pos = [81, 4];
  stereoSplit.pos = [84, 4];
  audio.pos = [89, 4];

  function removeCable(outputModuleId, outputId, inputModuleId, inputId) {
    const before = patch.cables.length;
    patch.cables = patch.cables.filter(
      (item) =>
        !(
          item.outputModuleId === outputModuleId &&
          item.outputId === outputId &&
          item.inputModuleId === inputModuleId &&
          item.inputId === inputId
        ),
    );
    if (patch.cables.length !== before - 1) {
      throw new Error(`expected one cable ${outputModuleId}:${outputId} -> ${inputModuleId}:${inputId}`);
    }
  }

  removeCable(13, 2, bassVco.id, 0);
  removeCable(stereoFade.id, 0, haze.id, 0);
  removeCable(stereoFade.id, 1, haze.id, 1);

  let nextCableId = Math.max(...patch.cables.map((cable) => cable.id)) + 1;
  function addCable(outputModule, outputId, inputModule, inputId) {
    patch.cables.push({
      id: nextCableId,
      outputModuleId: outputModule.id,
      outputId,
      inputModuleId: inputModule.id,
      inputId,
      color: colors[(nextCableId++ - 1) % colors.length],
    });
  }

  // Dedicated bass pitch now reaches both the original square bass and the
  // four-oscillator Doom voice.
  addCable(bassSlew, 4, bassVco, 0);
  addCable(bassSlew, 4, elemental, 0);
  addCable(macroSplit, 3, elemental, 6); // chaos -> bounded Omen variation
  addCable(macroSplit, 1, elemental, 14); // brightness -> cutoff
  addCable(operon, 0, elemental, 1); // slow movement -> ring modulation
  addCable(bassAdsr, 0, doomVca, 0);
  addCable(bassAdsr, 0, doomVca, 3);
  // The linear inputs multiply the envelope by /synth, so !mix synth 0
  // silences the entire Doom oscillator bank along with the base synth lanes.
  const oscInstrumentExpander = assertModule(patch, 3, 'trowaSoft', 'cvOSCcv-OutputExpander-16');
  addCable(oscInstrumentExpander, 5, doomVca, 1);
  addCable(oscInstrumentExpander, 5, doomVca, 4);
  addCable(elemental, 0, doomVca, 2);
  addCable(elemental, 1, doomVca, 5);

  // Stereo main bus + Doom voice -> sidechain compression -> lunar saturation
  // -> dark hall -> the existing animated Haze and protected output chain.
  addCable(stereoFade, 0, pressedDuck, 0);
  addCable(stereoFade, 1, pressedDuck, 1);
  addCable(doomVca, 0, pressedDuck, 2);
  addCable(doomVca, 1, pressedDuck, 3);
  addCable(kickVca, 0, pressedDuck, 25);
  addCable(kickVca, 0, pressedDuck, 26);
  addCable(pressedDuck, 0, moonDrive, 1);
  addCable(pressedDuck, 1, moonDrive, 2);
  addCable(operon, 1, moonDrive, 0);
  addCable(moonDrive, 0, liminal, 3);
  addCable(moonDrive, 1, liminal, 4);
  addCable(macroSplit, 2, liminal, 2); // /space controls wet mix
  addCable(liminal, 0, haze, 0);
  addCable(liminal, 1, haze, 1);

  const moduleIds = new Set(patch.modules.map((module) => module.id));
  if (moduleIds.size !== patch.modules.length) throw new Error('module IDs are not unique');

  const inputDestinations = new Set();
  for (const cable of patch.cables) {
    if (!moduleIds.has(cable.outputModuleId) || !moduleIds.has(cable.inputModuleId)) {
      throw new Error(`cable ${cable.id} has a missing endpoint`);
    }
    const destination = `${cable.inputModuleId}:${cable.inputId}`;
    if (inputDestinations.has(destination)) throw new Error(`multiple cables target ${destination}`);
    inputDestinations.add(destination);
  }

  const oscMain = assertModule(patch, 1, 'trowaSoft', 'cvOSCcv');
  const oscPrimaryExpander = assertModule(patch, 2, 'trowaSoft', 'cvOSCcv-OutputExpander-16');
  const actualOscPaths = [
    ...(oscMain.data?.inputChannels || []).map((channel) => channel.path),
    ...(oscPrimaryExpander.data?.outputChannels || []).map((channel) => channel.path),
    ...(oscInstrumentExpander.data?.outputChannels || []).map((channel) => channel.path),
  ];
  if (actualOscPaths.join(',') !== expectedOscPaths.join(',')) {
    throw new Error(`OSC channel contract differs: ${actualOscPaths.join(', ')}`);
  }
  if (
    oscMain.rightModuleId !== oscPrimaryExpander.id ||
    oscPrimaryExpander.leftModuleId !== oscMain.id ||
    oscPrimaryExpander.rightModuleId !== oscInstrumentExpander.id ||
    oscInstrumentExpander.leftModuleId !== oscPrimaryExpander.id
  ) {
    throw new Error('cvOSCcv expander adjacency is not reciprocal');
  }

  const expectedModules = [
    ['EternalEclipseModular', 'ElementalRevelator'],
    ['Fundamental', 'VCA'],
    ['CVfunk', 'PressedDuck'],
    ['EternalEclipseModular', 'MoonPhaseDistortion'],
    ['EternalEclipseModular', 'LiminalVast'],
  ];
  for (const [plugin, model] of expectedModules) {
    if (!patch.modules.some((module) => module.plugin === plugin && module.model === model)) {
      throw new Error(`missing Doom Jazz module ${plugin}/${model}`);
    }
  }
  if (
    pressedDuck.data?.mutedSideDucks !== true ||
    pressedDuck.data?.muteState?.length !== 7 ||
    pressedDuck.data.muteState[6] !== true ||
    pressedDuck.data?.fadeLevel?.length !== 7 ||
    pressedDuck.data.fadeLevel[6] !== 0 ||
    pressedDuck.data?.transitionCount?.some((count) => count !== 0)
  ) {
    throw new Error('Pressed Duck sidechain must duck while remaining absent from the audible mix');
  }

  if (patch.modules.length !== 59 || patch.cables.length !== 120) {
    throw new Error(`unexpected Doom Jazz patch size: ${patch.modules.length} modules, ${patch.cables.length} cables`);
  }

  fs.writeFileSync(patchFile, `${JSON.stringify(patch, null, 2)}\n`);
  const archiveTar = run('tar', ['-cf', '-', '-C', tempDir, '.']);
  const compressed = run('zstd', ['-q', '-6', '--stdout'], { input: archiveTar });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, compressed);

  console.log(`Built ${outputPath}`);
  console.log(`Modules: ${patch.modules.length}; cables: ${patch.cables.length}; OSC channels: ${actualOscPaths.length}`);
  console.log('Profile: Focalor four-oscillator bass, kick sidechain, lunar saturation, dark hall, protected stereo output.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
