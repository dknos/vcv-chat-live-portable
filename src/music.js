import { EventEmitter } from 'node:events';

import { SECTION_TYPES, advanceArrangement, sceneGrammarState } from './pattern-grammar.js';
import { resolveSongInfluence, songInfluenceNames } from './song-influences.js';

export const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const SCALES = [
  'major',
  'minor',
  'dorian',
  'mixolydian',
  'phrygian',
  'lydian',
  'pentatonic',
  'harmonic-minor',
];

// Kept intentionally consonant: the cycle gives the lead fresh colors without
// turning a settled phrase into an atonal jump-scare.
export const SCALE_CYCLES = Object.freeze({
  jazz: Object.freeze(['dorian', 'mixolydian', 'lydian', 'major', 'minor']),
});

export const SCENES = {
  ambient: {
    tempo: 78,
    scale: 'pentatonic',
    energy: 0.24,
    density: 0.28,
    brightness: 0.42,
    space: 0.86,
    chaos: 0.14,
    drums: false,
  },
  chill: {
    tempo: 92,
    scale: 'dorian',
    energy: 0.34,
    density: 0.4,
    brightness: 0.5,
    space: 0.65,
    chaos: 0.16,
    drums: true,
  },
  house: {
    tempo: 124,
    scale: 'minor',
    energy: 0.64,
    density: 0.62,
    brightness: 0.62,
    space: 0.38,
    chaos: 0.2,
    drums: true,
  },
  techno: {
    tempo: 132,
    scale: 'minor',
    energy: 0.76,
    density: 0.68,
    brightness: 0.58,
    space: 0.28,
    chaos: 0.32,
    drums: true,
  },
  acid: {
    tempo: 132,
    scale: 'dorian',
    energy: 0.76,
    density: 0.7,
    brightness: 0.78,
    space: 0.3,
    chaos: 0.46,
    drums: true,
  },
  trance: {
    tempo: 138,
    scale: 'minor',
    energy: 0.78,
    density: 0.7,
    brightness: 0.76,
    space: 0.55,
    chaos: 0.24,
    drums: true,
  },
  dubstep: {
    tempo: 140,
    scale: 'phrygian',
    energy: 0.86,
    density: 0.58,
    brightness: 0.48,
    space: 0.24,
    chaos: 0.52,
    drums: true,
  },
  dnb: {
    tempo: 172,
    scale: 'minor',
    energy: 0.9,
    density: 0.86,
    brightness: 0.64,
    space: 0.24,
    chaos: 0.48,
    drums: true,
  },
  jungle: {
    tempo: 168,
    scale: 'minor',
    energy: 0.88,
    density: 0.9,
    brightness: 0.58,
    space: 0.3,
    chaos: 0.42,
    drums: true,
  },
  generative: {
    tempo: 108,
    scale: 'pentatonic',
    energy: 0.48,
    density: 0.5,
    brightness: 0.55,
    space: 0.62,
    chaos: 0.7,
    drums: true,
  },
  dark: {
    tempo: 112,
    scale: 'phrygian',
    energy: 0.58,
    density: 0.5,
    brightness: 0.24,
    space: 0.7,
    chaos: 0.44,
    drums: true,
  },
};

export const SCENE_NAMES = Object.keys(SCENES);

export const INITIAL_STATE = Object.freeze({
  tempo: 112,
  root: 0,
  scale: 'minor',
  energy: 0.52,
  density: 0.5,
  brightness: 0.52,
  space: 0.42,
  chaos: 0.24,
  scene: 'generative',
  seed: 0x5eed1234,
  drums: true,
  piano: false,
  guitar: false,
  swing: 0.08,
  phraseLength: 8,
  leadOctave: 5,
  bassOctave: 2,
  leadArticulation: 0.62,
  bassArticulation: 0.72,
  drumMix: 0.82,
  synthMix: 0.84,
  pianoMix: 0.62,
  guitarMix: 0.56,
  tension: 0.34,
  release: 0.22,
  mutation: Object.freeze({ lead: 0.24, bass: 0.14, drums: 0.18, harmony: 0.08 }),
  ...sceneGrammarState('generative'),
  muted: false,
  frozen: false,
  influenceId: null,
  influenceTitle: null,
  influenceArtist: null,
  influenceProgressions: null,
  currentChordSemitone: null,
  currentChordQuality: '',
  currentChordBassSemitone: null,
  scaleCycleEnabled: false,
  scaleCyclePalette: SCALE_CYCLES.jazz,
  scaleCycleBars: 8,
  scaleCycleIndex: 0,
  scaleCycleProgress: 0,
});

const LEVEL_FIELDS = new Set(['energy', 'density', 'brightness', 'space', 'chaos', 'tension', 'release']);
const DIRECT_COMMANDS = new Set([
  'tempo',
  'key',
  'scale',
  ...LEVEL_FIELDS,
  'scene',
  'swing',
  'phrase',
  'progression',
  'chords',
  'octave',
  'articulation',
  'mix',
  'section',
  'mutation',
  'vibe',
  'mood',
  'influence',
  'freebird',
  'jubilee',
  'stairway',
  'drums',
  'add',
  'remove',
  'mutate',
  'drop',
  'mute',
  'unmute',
  'freeze',
  'unfreeze',
  'reset',
  'panic',
  'help',
]);

const ADMIN_COMMANDS = new Set(['mute', 'unmute', 'freeze', 'unfreeze', 'reset', 'panic']);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value, max = 100) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function hash32(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function randomFromSeed(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function parseLevel(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const percent = text.endsWith('%');
  const value = Number(percent ? text.slice(0, -1) : text);
  if (!Number.isFinite(value)) return null;
  const normalized = percent || value > 1 ? value / 100 : value;
  if (normalized < 0 || normalized > 1) return null;
  return normalized;
}

function normalizeRootName(raw) {
  const match = String(raw || '').trim().match(/^([a-gA-G])([#b]?)(m|min|minor)?$/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const aliases = {
    Cb: 'B',
    Db: 'C#',
    'D#': 'Eb',
    Fb: 'E',
    'E#': 'F',
    Gb: 'F#',
    'G#': 'Ab',
    'A#': 'Bb',
    'B#': 'C',
  };
  const rootName = aliases[`${letter}${accidental}`] || `${letter}${accidental}`;
  const root = ROOTS.indexOf(rootName);
  if (root < 0) return null;
  return {
    root,
    impliedScale: match[3] ? 'minor' : null,
  };
}

function normalizeScale(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  const aliases = {
    maj: 'major',
    ionian: 'major',
    min: 'minor',
    aeolian: 'minor',
    pent: 'pentatonic',
    harmonicminor: 'harmonic-minor',
    harmonic_minor: 'harmonic-minor',
  };
  const normalized = aliases[value] || value;
  return SCALES.includes(normalized) ? normalized : null;
}

function boolWord(raw) {
  if (/^(on|yes|1|true)$/i.test(String(raw || ''))) return true;
  if (/^(off|no|0|false)$/i.test(String(raw || ''))) return false;
  return null;
}

const ROMAN_DEGREES = Object.freeze({ i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 });
const SCALE_SEMITONES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9], 'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
});

function parseProgression(raw) {
  const tokens = String(raw || '').trim().split(/[\s,–—-]+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8) return null;
  const degrees = tokens.map((token) => {
    const roman = token.replace(/[^ivIV]/g, '').toLowerCase();
    if (roman in ROMAN_DEGREES) return ROMAN_DEGREES[roman];
    const numeric = Number(token);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= 7 ? numeric - 1 : null;
  });
  return degrees.every((degree) => degree !== null) ? degrees : null;
}

function progressionText(progression) {
  const names = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  return progression.map((degree) => names[degree] || 'I').join('-');
}

function sceneChanges(scene) {
  return {
    ...SCENES[scene],
    ...sceneGrammarState(scene),
    scene,
    influenceId: null,
    influenceTitle: null,
    influenceArtist: null,
    influenceProgressions: null,
    currentChordSemitone: null,
    currentChordQuality: '',
    currentChordBassSemitone: null,
  };
}

function chordName(state) {
  if (Number.isFinite(state.currentChordSemitone)) {
    const root = ROOTS[((state.root + state.currentChordSemitone) % ROOTS.length + ROOTS.length) % ROOTS.length];
    const slash = Number.isFinite(state.currentChordBassSemitone)
      ? `/${ROOTS[((state.root + state.currentChordBassSemitone) % ROOTS.length + ROOTS.length) % ROOTS.length]}`
      : '';
    return `${root}${state.currentChordQuality || ''}${slash}`;
  }
  const intervals = SCALE_SEMITONES[state.scale] || SCALE_SEMITONES.minor;
  const degree = ((state.currentChordDegree || 0) % intervals.length + intervals.length) % intervals.length;
  const root = ROOTS[(state.root + intervals[degree]) % ROOTS.length];
  const minorish = ['minor', 'dorian', 'phrygian', 'harmonic-minor'].includes(state.scale);
  const quality = degree === 0 && minorish ? 'm' : degree === 6 ? 'dim' : '';
  return `${root}${quality}`;
}

function sceneForText(text, rand) {
  const tests = [
    ['jungle', /\b(jungle|amen|ragga|chopped breaks?)\b/i],
    ['dnb', /\b(dnb|drum\s*(and|&)\s*bass|breakcore|breaks?)\b/i],
    ['dubstep', /\b(dubstep|wobble|reese|growl|half[ -]?time)\b/i],
    ['acid', /\b(acid|303)\b/i],
    ['trance', /\b(trance|uplifting|arpeggio|arp)\b/i],
    ['techno', /\b(techno|industrial|warehouse)\b/i],
    ['house', /\b(house|disco|four on the floor)\b/i],
    ['ambient', /\b(ambient|drone|meditat|underwater|spacey|ethereal)\b/i],
    ['chill', /\b(chill|lofi|lo-fi|relax|mellow|soft|swing|shuffle|jazzy?|groove)\b/i],
    ['dark', /\b(dark|spooky|haunt|horror|sinister|evil|night)\b/i],
    ['generative', /\b(generative|random|weird|alien|glitch|experimental)\b/i],
  ];
  for (const [scene, regex] of tests) {
    if (regex.test(text)) return scene;
  }
  const fallback = ['generative', 'chill', 'house', 'techno', 'ambient'];
  return fallback[Math.floor(rand() * fallback.length)];
}

export function vibeToChanges(rawText) {
  const text = cleanText(rawText, 160).toLowerCase();
  if (!text) return null;
  const seed = hash32(text);
  const rand = randomFromSeed(seed);
  const scene = sceneForText(text, rand);
  const base = SCENES[scene];
  const jitter = () => (rand() - 0.5) * 0.12;
  const changes = {
    ...sceneChanges(scene),
    seed,
    root: Math.floor(rand() * ROOTS.length),
    energy: clamp(base.energy + jitter()),
    density: clamp(base.density + jitter()),
    brightness: clamp(base.brightness + jitter()),
    space: clamp(base.space + jitter()),
    chaos: clamp(base.chaos + jitter()),
  };

  if (/\b(fast|faster|speed|rush)\b/.test(text)) changes.tempo = Math.max(changes.tempo, 148);
  if (/\b(slow|slower|sleepy)\b/.test(text)) changes.tempo = Math.min(changes.tempo, 84);
  if (/\b(hard|heavy|aggressive|intense|huge|angry)\b/.test(text)) {
    changes.energy = Math.max(changes.energy, 0.86);
    changes.density = Math.max(changes.density, 0.7);
  }
  if (/\b(bright|happy|sunny|sparkly|shimmer)\b/.test(text)) {
    changes.brightness = Math.max(changes.brightness, 0.78);
    changes.scale = /\b(dreamy|shimmer)\b/.test(text) ? 'lydian' : 'major';
  }
  if (/\b(dark|spooky|haunt|horror|sinister|evil)\b/.test(text)) {
    changes.brightness = Math.min(changes.brightness, 0.28);
    changes.scale = 'phrygian';
  }
  if (/\b(dry|tight|close)\b/.test(text)) changes.space = Math.min(changes.space, 0.22);
  if (/\b(wet|huge room|cavern|echo|reverb)\b/.test(text)) changes.space = Math.max(changes.space, 0.78);
  if (/\b(no drums|drumless|without drums)\b/.test(text)) changes.drums = false;
  if (/\b(more drums|with drums|drums on)\b/.test(text)) changes.drums = true;
  if (/\b(swing|shuffle|jazzy?|groove)\b/.test(text)) changes.swing = Math.max(changes.swing || 0, 0.24);

  return changes;
}

function extractCommand(text, prefix, directAliases) {
  const cleaned = cleanText(text, 240);
  const lower = cleaned.toLowerCase();
  if (lower === prefix || lower.startsWith(`${prefix} `)) {
    return cleaned.slice(prefix.length).trim();
  }
  if (!directAliases || !cleaned.startsWith('!')) return null;
  const match = cleaned.match(/^!([a-z-]+)(?:\s+([\s\S]*))?$/i);
  if (!match || !DIRECT_COMMANDS.has(match[1].toLowerCase())) return null;
  return `${match[1]} ${match[2] || ''}`.trim();
}

export function parseChatCommand(text, options = {}) {
  const prefix = (options.prefix || '!rack').toLowerCase();
  const commandText = extractCommand(text, prefix, options.directAliases !== false);
  if (commandText === null) return { matched: false };
  if (!commandText) return { matched: true, ok: false, error: 'missing command' };

  const [rawName, ...restParts] = commandText.split(/\s+/);
  const name = rawName.toLowerCase();
  const rest = restParts.join(' ').trim();

  if (['freebird', 'jubilee', 'stairway'].includes(name)) {
    const shortcut = name === 'freebird' ? 'freebird' : `${name} ${rest}`;
    const influence = resolveSongInfluence(shortcut);
    if (!influence) return { matched: true, ok: false, error: `use !influence ${shortcut}` };
    return {
      matched: true,
      ok: true,
      action: {
        kind: 'event',
        event: 'mutate',
        changes: influence.changes,
        label: `influence ${influence.title}`,
      },
    };
  }

  if (name === 'help') {
    return { matched: true, ok: true, action: { kind: 'help', label: 'show commands' } };
  }
  if (name === 'tempo') {
    const tempo = Number(rest);
    if (!Number.isFinite(tempo) || tempo < 60 || tempo > 180) {
      return { matched: true, ok: false, error: 'tempo must be 60-180 BPM' };
    }
    return {
      matched: true,
      ok: true,
      action: { kind: 'state', changes: { tempo: Math.round(tempo) }, label: `tempo ${Math.round(tempo)}` },
    };
  }
  if (name === 'key') {
    const [rootRaw, scaleRaw] = rest.split(/\s+/, 2);
    const key = normalizeRootName(rootRaw);
    const scale = scaleRaw ? normalizeScale(scaleRaw) : key?.impliedScale;
    if (!key || (scaleRaw && !scale)) {
      return { matched: true, ok: false, error: 'key must look like C, F#, Eb, or C# minor' };
    }
    const changes = { root: key.root };
    if (scale) changes.scale = scale;
    return {
      matched: true,
      ok: true,
      action: {
        kind: 'state',
        changes,
        label: `key ${ROOTS[key.root]}${scale === 'minor' ? 'm' : scale ? ` ${scale}` : ''}`,
      },
    };
  }
  if (name === 'scale') {
    const cycle = rest.toLowerCase().match(/^cycle(?:\s+(4|8|16))?$/);
    if (cycle) {
      const scaleCycleBars = Number(cycle[1] || 8);
      return {
        matched: true,
        ok: true,
        action: {
          kind: 'state',
          changes: {
            scaleCycleEnabled: true,
            scaleCyclePalette: [...SCALE_CYCLES.jazz],
            scaleCycleBars,
            // -1 means the first completed phrase resolves into Dorian.
            scaleCycleIndex: -1,
            scaleCycleProgress: 0,
          },
          label: `jazz scale cycle / ${scaleCycleBars} bars`,
        },
      };
    }
    if (/^(stop|off)$/i.test(rest)) {
      return {
        matched: true,
        ok: true,
        action: { kind: 'state', changes: { scaleCycleEnabled: false, scaleCycleProgress: 0 }, label: 'scale cycle stopped' },
      };
    }
    const scale = normalizeScale(rest);
    if (!scale) {
      return { matched: true, ok: false, error: `scale must be one of: ${SCALES.join(', ')}` };
    }
    return { matched: true, ok: true, action: { kind: 'state', changes: { scale }, label: `scale ${scale}` } };
  }
  if (name === 'influence') {
    const influence = resolveSongInfluence(rest);
    if (!influence) {
      return {
        matched: true,
        ok: false,
        error: `available influences: ${songInfluenceNames().join(', ')}`,
      };
    }
    return {
      matched: true,
      ok: true,
      action: {
        kind: 'event',
        event: 'mutate',
        changes: influence.changes,
        label: `influence ${influence.title}`,
      },
    };
  }
  if (LEVEL_FIELDS.has(name)) {
    const value = parseLevel(rest);
    if (value === null) {
      return { matched: true, ok: false, error: `${name} must be 0-1 or 0-100%` };
    }
    return {
      matched: true,
      ok: true,
      action: {
        kind: 'state',
        changes: { [name]: value },
        label: `${name} ${Math.round(value * 100)}%`,
      },
    };
  }
  if (name === 'swing') {
    const swing = parseLevel(rest);
    if (swing === null || swing > 0.5) return { matched: true, ok: false, error: 'swing must be 0-50%' };
    return { matched: true, ok: true, action: { kind: 'state', changes: { swing }, label: `swing ${Math.round(swing * 100)}%` } };
  }
  if (name === 'phrase') {
    const phraseLength = Number(rest);
    if (![2, 4, 8, 16].includes(phraseLength)) return { matched: true, ok: false, error: 'phrase must be 2, 4, 8, or 16 bars' };
    return { matched: true, ok: true, action: { kind: 'state', changes: { phraseLength }, label: `phrase ${phraseLength} bars` } };
  }
  if (name === 'progression' || name === 'chords') {
    const chordProgression = parseProgression(rest);
    if (!chordProgression) return { matched: true, ok: false, error: 'use 2-8 chord degrees, e.g. i-VI-III-VII' };
    return {
      matched: true,
      ok: true,
      action: {
        kind: 'state',
        changes: {
          chordProgression,
          currentChordDegree: chordProgression[0],
          influenceId: null,
          influenceTitle: null,
          influenceArtist: null,
          influenceProgressions: null,
          currentChordSemitone: null,
          currentChordQuality: '',
          currentChordBassSemitone: null,
        },
        label: `chords ${progressionText(chordProgression)}`,
      },
    };
  }
  if (name === 'octave') {
    const [lane, rawValue] = rest.toLowerCase().split(/\s+/, 2);
    const value = Number(rawValue);
    const valid = lane === 'lead' ? Number.isInteger(value) && value >= 2 && value <= 7 : lane === 'bass' && Number.isInteger(value) && value >= 0 && value <= 4;
    if (!valid) return { matched: true, ok: false, error: 'use octave lead 2-7 or octave bass 0-4' };
    return { matched: true, ok: true, action: { kind: 'state', changes: { [`${lane}Octave`]: value }, label: `${lane} octave ${value}` } };
  }
  if (name === 'articulation') {
    const [lane, rawValue] = rest.toLowerCase().split(/\s+/, 2);
    const value = parseLevel(rawValue);
    if (!['lead', 'bass'].includes(lane) || value === null) return { matched: true, ok: false, error: 'use articulation lead|bass 0-100' };
    return { matched: true, ok: true, action: { kind: 'state', changes: { [`${lane}Articulation`]: value }, label: `${lane} articulation ${Math.round(value * 100)}%` } };
  }
  if (name === 'mix') {
    const [instrument, rawValue] = rest.toLowerCase().split(/\s+/, 2);
    const value = parseLevel(rawValue);
    const fields = { drums: 'drumMix', synth: 'synthMix', piano: 'pianoMix', guitar: 'guitarMix' };
    if (!fields[instrument] || value === null) return { matched: true, ok: false, error: 'use mix drums|synth|piano|guitar 0-100' };
    const changes = { [fields[instrument]]: value };
    if (instrument === 'drums') changes.drums = value > 0;
    if (instrument === 'piano' || instrument === 'guitar') changes[instrument] = value > 0;
    return { matched: true, ok: true, action: { kind: 'state', changes, label: `${instrument} mix ${Math.round(value * 100)}%` } };
  }
  if (name === 'section') {
    const section = rest.toLowerCase();
    if (!SECTION_TYPES.includes(section)) return { matched: true, ok: false, error: `section must be: ${SECTION_TYPES.join(', ')}` };
    return { matched: true, ok: true, action: { kind: 'state', changes: { section, sectionIndex: 0, sectionBars: 8, sectionBarsRemaining: 8 }, label: `section ${section}` } };
  }
  if (name === 'mutation') {
    const [lane, rawValue] = rest.toLowerCase().split(/\s+/, 2);
    const value = parseLevel(rawValue);
    if (!['lead', 'bass', 'drums', 'harmony'].includes(lane) || value === null) return { matched: true, ok: false, error: 'use mutation lead|bass|drums|harmony 0-100' };
    return { matched: true, ok: true, action: { kind: 'state', changes: { mutation: { [lane]: value } }, label: `${lane} mutation ${Math.round(value * 100)}%` } };
  }
  if (name === 'scene') {
    const scene = rest.toLowerCase();
    if (!SCENES[scene]) {
      return { matched: true, ok: false, error: `scene must be one of: ${SCENE_NAMES.join(', ')}` };
    }
    return {
      matched: true,
      ok: true,
      action: { kind: 'state', changes: sceneChanges(scene), label: `scene ${scene}` },
    };
  }
  if (name === 'vibe' || name === 'mood') {
    const changes = vibeToChanges(rest);
    if (!changes) return { matched: true, ok: false, error: 'vibe needs a short description' };
    return {
      matched: true,
      ok: true,
      action: { kind: 'event', event: 'mutate', changes, label: `vibe ${cleanText(rest, 64)}` },
    };
  }
  if (name === 'drums') {
    const drums = boolWord(rest);
    if (drums === null) return { matched: true, ok: false, error: 'drums must be on or off' };
    return { matched: true, ok: true, action: { kind: 'state', changes: { drums }, label: `drums ${drums ? 'on' : 'off'}` } };
  }
  if (name === 'add' || name === 'remove') {
    const instrument = rest.toLowerCase().replace(/\s+/g, ' ').trim();
    const field = instrument === 'piano' ? 'piano' : ['guitar', 'electric guitar'].includes(instrument) ? 'guitar' : null;
    if (!field) return { matched: true, ok: false, error: 'choose piano or guitar' };
    const enabled = name === 'add';
    return {
      matched: true,
      ok: true,
      action: { kind: 'state', changes: { [field]: enabled }, label: `${enabled ? 'add' : 'remove'} ${field}` },
    };
  }
  if (name === 'mutate') {
    const [lane, rawValue] = rest.toLowerCase().split(/\s+/, 2);
    if (['lead', 'bass', 'drums', 'harmony'].includes(lane) && rawValue) {
      const value = parseLevel(rawValue);
      if (value === null) return { matched: true, ok: false, error: 'mutation strength must be 0-100' };
      return { matched: true, ok: true, action: { kind: 'state', changes: { mutation: { [lane]: value } }, label: `${lane} mutation ${Math.round(value * 100)}%` } };
    }
    const seed = hash32(`${Date.now()}:${rest || 'mutate'}`);
    return {
      matched: true,
      ok: true,
      action: { kind: 'event', event: 'mutate', changes: { seed }, label: 'mutate pattern' },
    };
  }
  if (name === 'drop') {
    return {
      matched: true,
      ok: true,
      action: {
        kind: 'event',
        event: 'drop',
        changes: { energy: 0.94, density: 0.82, brightness: 0.7, space: 0.24, drums: true },
        label: 'drop',
      },
    };
  }
  if (ADMIN_COMMANDS.has(name)) {
    return {
      matched: true,
      ok: true,
      action: { kind: 'admin', command: name, label: name },
    };
  }

  return { matched: true, ok: false, error: `unknown command: ${name}` };
}

export function stateToOscValues(state) {
  const scaleIndex = Math.max(0, SCALES.indexOf(state.scale));
  const sceneIndex = Math.max(0, SCENE_NAMES.indexOf(state.scene));
  return {
    tempo: clamp((state.tempo - 60) / 120) * 10,
    root: clamp(state.root / 11) * 10,
    scale: clamp(scaleIndex / Math.max(1, SCALES.length - 1)) * 10,
    energy: clamp(state.energy) * 10,
    density: clamp(state.density) * 10,
    brightness: clamp(state.brightness) * 10,
    space: clamp(state.space) * 10,
    chaos: clamp(state.chaos) * 10,
    scene: clamp(sceneIndex / Math.max(1, SCENE_NAMES.length - 1)) * 10,
    seed: ((state.seed >>> 0) / 0xffffffff) * 10,
    drums: state.drums ? clamp(state.drumMix ?? 1) * 10 : 0,
    piano: state.piano ? clamp(state.pianoMix ?? 1) * 10 : 0,
    guitar: state.guitar ? clamp(state.guitarMix ?? 1) * 10 : 0,
    synth: clamp(state.synthMix ?? 1) * 10,
    // This is a fail-closed master gate: Rack is silent until the bridge
    // explicitly announces a healthy, unmuted state.
    mute: state.muted ? 0 : 10,
    freeze: state.frozen ? 10 : 0,
  };
}

function barDurationMs(tempo, beatsPerBar) {
  return (60_000 / tempo) * beatsPerBar;
}

function cloneState(state) {
  return {
    ...state,
    chordProgression: [...(state.chordProgression || [])],
    scaleCyclePalette: [...(state.scaleCyclePalette || SCALE_CYCLES.jazz)],
    mutation: { ...(state.mutation || {}) },
    influenceProgressions: state.influenceProgressions
      ? Object.fromEntries(Object.entries(state.influenceProgressions).map(([section, progression]) => [
        section,
        progression.map((entry) => ({ ...entry })),
      ]))
      : null,
  };
}

function advanceScaleCycle(state) {
  if (!state.scaleCycleEnabled) return null;
  const palette = (state.scaleCyclePalette || []).filter((scale) => SCALES.includes(scale));
  if (!palette.length) {
    state.scaleCycleEnabled = false;
    return null;
  }
  const bars = [4, 8, 16].includes(state.scaleCycleBars) ? state.scaleCycleBars : 8;
  state.scaleCycleProgress = (state.scaleCycleProgress || 0) + 1;
  if (state.scaleCycleProgress < bars) return null;
  state.scaleCycleProgress = 0;
  state.scaleCycleIndex = ((state.scaleCycleIndex || 0) + 1) % palette.length;
  state.scale = palette[state.scaleCycleIndex];
  return state.scale;
}

function mergeStateChanges(state, changes = {}) {
  const mutation = changes.mutation ? { ...(state.mutation || {}), ...changes.mutation } : state.mutation;
  Object.assign(state, changes);
  if (mutation) state.mutation = mutation;
  if (changes.chordProgression) state.chordProgression = [...changes.chordProgression];
  if (changes.influenceProgressions) {
    state.influenceProgressions = Object.fromEntries(
      Object.entries(changes.influenceProgressions).map(([section, progression]) => [
        section,
        progression.map((entry) => ({ ...entry })),
      ]),
    );
  }
  return state;
}

export class MusicController extends EventEmitter {
  constructor({ config, osc, now = () => Date.now(), initialState = INITIAL_STATE }) {
    super();
    this.config = config;
    this.osc = osc;
    this.now = now;
    this.state = cloneState(initialState);
    this.pending = [];
    this.recent = [];
    this.lastByUser = new Map();
    this.lastGlobalAt = Number.NEGATIVE_INFINITY;
    this.nextBarAt = this.now() + barDurationMs(this.state.tempo, config.scheduler.beatsPerBar);
    this.tickBusy = false;
  }

  isTrusted(message) {
    if (message.isOwner || message.isModerator || message.trusted) return true;
    if (message.channelId && this.config.commands.trustedChannelIds.has(message.channelId)) return true;
    const name = cleanText(message.name, 80).toLowerCase();
    return !!name && this.config.commands.trustedDisplayNames.has(name);
  }

  record(status, message, label, detail = '') {
    const item = {
      at: new Date(this.now()).toISOString(),
      status,
      author: cleanText(message?.name || 'viewer', 48),
      label: cleanText(label, 100),
      detail: cleanText(detail, 140),
    };
    this.recent.push(item);
    if (this.recent.length > 12) this.recent.shift();
    this.emit('activity', item);
    this.emit('snapshot', this.snapshot());
    return item;
  }

  snapshot() {
    return {
      state: { ...cloneState(this.state), rootName: ROOTS[this.state.root], currentChord: chordName(this.state) },
      pending: this.pending.map((entry) => ({
        author: cleanText(entry.message.name || 'viewer', 48),
        label: entry.action.label,
      })),
      recent: [...this.recent],
      nextBarAt: new Date(this.nextBarAt).toISOString(),
      nextBarInMs: Math.max(0, this.nextBarAt - this.now()),
    };
  }

  async sync() {
    const values = stateToOscValues(this.state);
    await this.osc.sendMany(Object.entries(values));
    await this.osc.send('change', 1);
    this.emit('snapshot', this.snapshot());
  }

  async submit(message) {
    const parsed = parseChatCommand(message.text, {
      prefix: this.config.commands.prefix,
      directAliases: this.config.commands.directAliases,
    });
    if (!parsed.matched) return { status: 'ignored' };
    if (!parsed.ok) {
      this.record('rejected', message, 'invalid command', parsed.error);
      return { status: 'rejected', reason: parsed.error };
    }

    const action = parsed.action;
    const trusted = this.isTrusted(message);
    if (action.kind === 'admin' && !trusted) {
      this.record('rejected', message, action.label, 'owner/mod only');
      return { status: 'rejected', reason: 'owner/mod only' };
    }
    if (action.kind === 'help') {
      this.record('help', message, action.label);
      return { status: 'help' };
    }

    const now = this.now();
    const userKey = message.channelId || cleanText(message.name || 'viewer', 80).toLowerCase();
    if (!trusted) {
      const lastUserAt = this.lastByUser.get(userKey) ?? Number.NEGATIVE_INFINITY;
      if (now - lastUserAt < this.config.commands.perUserCooldownMs) {
        this.record('rejected', message, action.label, 'viewer cooldown');
        return { status: 'rejected', reason: 'viewer cooldown' };
      }
      if (now - this.lastGlobalAt < this.config.commands.globalCooldownMs) {
        this.record('rejected', message, action.label, 'crowd cooldown');
        return { status: 'rejected', reason: 'crowd cooldown' };
      }
    }

    if (this.state.frozen && !trusted) {
      this.record('rejected', message, action.label, 'controls are frozen');
      return { status: 'rejected', reason: 'controls frozen' };
    }

    this.lastByUser.set(userKey, now);
    this.lastGlobalAt = now;

    if (action.kind === 'admin') {
      await this.applyAdmin(action.command, message);
      return { status: 'applied', action };
    }

    if (!this.config.scheduler.quantizeBars) {
      await this.applyBatch([{ action, message }]);
      return { status: 'applied', action };
    }

    if (this.pending.length >= this.config.commands.maxActionsPerBar) {
      this.record('rejected', message, action.label, 'bar queue is full');
      return { status: 'rejected', reason: 'bar queue full' };
    }
    this.pending.push({ action, message });
    this.record('queued', message, action.label, 'next bar');
    return { status: 'queued', action, at: this.nextBarAt };
  }

  async applyAdmin(command, message) {
    const before = cloneState(this.state);
    if (command === 'mute') this.state.muted = true;
    if (command === 'unmute') this.state.muted = false;
    if (command === 'freeze') this.state.frozen = true;
    if (command === 'unfreeze') this.state.frozen = false;
    if (command === 'reset') this.state = cloneState({ ...INITIAL_STATE, frozen: this.state.frozen });
    if (command === 'panic') {
      this.state.muted = true;
      this.state.frozen = true;
      this.pending = [];
    }
    const beforeValues = stateToOscValues(before);
    const afterValues = stateToOscValues(this.state);
    const entries = Object.entries(afterValues).filter(([key, value]) => beforeValues[key] !== value);
    await this.osc.sendMany(entries);
    if (command === 'panic') await this.osc.send('panic', 1);
    await this.osc.send('change', 1);
    this.record('applied', message, command, 'owner control');
  }

  async applyBatch(entries) {
    if (!entries.length) return;
    const before = cloneState(this.state);
    const events = [];
    for (const { action } of entries) {
      mergeStateChanges(this.state, action.changes || {});
      if (action.event) events.push(action.event);
    }
    const beforeValues = stateToOscValues(before);
    const values = stateToOscValues(this.state);
    await this.osc.sendMany(Object.entries(values).filter(([key, value]) => beforeValues[key] !== value));
    for (const event of events) await this.osc.send(event, 1);
    await this.osc.send('change', 1);
    for (const { action, message } of entries) {
      this.record(
        'applied',
        message,
        action.label,
        this.config.scheduler.quantizeBars ? 'bar boundary' : 'immediate',
      );
    }
  }

  async tick(at = this.now()) {
    if (this.tickBusy || at < this.nextBarAt) return false;
    this.tickBusy = true;
    try {
      let guard = 0;
      while (at >= this.nextBarAt && guard++ < 32) {
        const batch = this.pending.splice(0, this.config.commands.maxActionsPerBar);
        if (batch.length) await this.applyBatch(batch);
        advanceArrangement(this.state);
        const nextScale = advanceScaleCycle(this.state);
        if (nextScale) {
          await this.osc.send('scale', stateToOscValues(this.state).scale);
          await this.osc.send('change', 1);
          this.emit('scale-cycle', { scale: nextScale, bars: this.state.scaleCycleBars });
        }
        this.nextBarAt += barDurationMs(this.state.tempo, this.config.scheduler.beatsPerBar);
      }
      this.emit('snapshot', this.snapshot());
      return true;
    } finally {
      this.tickBusy = false;
    }
  }
}

export const __test = {
  clamp,
  cleanText,
  hash32,
  parseLevel,
  normalizeRootName,
  normalizeScale,
  boolWord,
  extractCommand,
  barDurationMs,
  advanceScaleCycle,
};
