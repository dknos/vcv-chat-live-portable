const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const SECTION_PROFILES = Object.freeze({
  intro: { density: 0.58, energy: 0.72, drums: 0.5, tension: -0.12, release: 0.22 },
  verse: { density: 0.9, energy: 0.9, drums: 0.86, tension: 0, release: 0.08 },
  build: { density: 1.08, energy: 1.04, drums: 1, tension: 0.24, release: -0.12 },
  drop: { density: 1.14, energy: 1.18, drums: 1.12, tension: 0.1, release: 0.28 },
  breakdown: { density: 0.5, energy: 0.66, drums: 0.34, tension: -0.2, release: 0.36 },
  outro: { density: 0.62, energy: 0.72, drums: 0.48, tension: -0.18, release: 0.3 },
});

export const SECTION_TYPES = Object.freeze(Object.keys(SECTION_PROFILES));

const ARRANGEMENTS = Object.freeze({
  slowArc: [['intro', 4], ['verse', 8], ['build', 4], ['drop', 8], ['breakdown', 4]],
  club: [['intro', 4], ['verse', 8], ['build', 4], ['drop', 8], ['breakdown', 4], ['drop', 8]],
  pressure: [['verse', 4], ['build', 4], ['drop', 8], ['breakdown', 4], ['drop', 8]],
  generative: [['intro', 4], ['verse', 8], ['build', 4], ['drop', 4], ['breakdown', 4]],
});

// Scenes are recipes made from independent musical vocabularies. The arrays
// here describe harmony and form, not literal 16-step note/drum sequences.
export const SCENE_GRAMMAR = Object.freeze({
  ambient: { rhythm: 'sparse', bass: 'pedal', melody: 'floating', syncopation: 'loose', timbre: 'mist', progression: [0, 3, 5, 4], arrangement: 'slowArc', swing: 0.12, phraseLength: 16, leadOctave: 4, bassOctave: 2, leadArticulation: 0.42, bassArticulation: 0.8, tension: 0.18, release: 0.55, drumMix: 0.35, synthMix: 0.72 },
  chill: { rhythm: 'backbeat', bass: 'warm', melody: 'contour', syncopation: 'laidBack', timbre: 'velvet', progression: [0, 3, 4, 0], arrangement: 'slowArc', swing: 0.18, phraseLength: 8, leadOctave: 4, bassOctave: 2, leadArticulation: 0.58, bassArticulation: 0.72, tension: 0.28, release: 0.38, drumMix: 0.66, synthMix: 0.72 },
  house: { rhythm: 'fourFloor', bass: 'offbeat', melody: 'chordal', syncopation: 'offbeat', timbre: 'club', progression: [0, 5, 3, 4], arrangement: 'club', swing: 0.08, phraseLength: 8, leadOctave: 5, bassOctave: 2, leadArticulation: 0.68, bassArticulation: 0.82, tension: 0.42, release: 0.25, drumMix: 0.88, synthMix: 0.78 },
  techno: { rhythm: 'fourFloor', bass: 'pulse', melody: 'minimal', syncopation: 'driving', timbre: 'steel', progression: [0, 0, 3, 1], arrangement: 'pressure', swing: 0.04, phraseLength: 8, leadOctave: 5, bassOctave: 1, leadArticulation: 0.46, bassArticulation: 0.9, tension: 0.58, release: 0.18, drumMix: 0.92, synthMix: 0.84 },
  acid: { rhythm: 'fourFloor', bass: 'acid', melody: 'acid', syncopation: 'driving', timbre: 'resonant', progression: [0, 3, 1, 4], arrangement: 'pressure', swing: 0.06, phraseLength: 8, leadOctave: 5, bassOctave: 2, leadArticulation: 0.86, bassArticulation: 0.9, tension: 0.68, release: 0.14, drumMix: 0.9, synthMix: 0.88 },
  trance: { rhythm: 'fourFloor', bass: 'offbeat', melody: 'arpeggio', syncopation: 'uplift', timbre: 'shimmer', progression: [0, 5, 3, 4], arrangement: 'club', swing: 0.04, phraseLength: 8, leadOctave: 5, bassOctave: 2, leadArticulation: 0.9, bassArticulation: 0.84, tension: 0.48, release: 0.32, drumMix: 0.86, synthMix: 0.9 },
  dubstep: { rhythm: 'halfTime', bass: 'reese', melody: 'stabs', syncopation: 'lurch', timbre: 'weight', progression: [0, 0, 1, 5], arrangement: 'pressure', swing: 0.1, phraseLength: 8, leadOctave: 5, bassOctave: 1, leadArticulation: 0.5, bassArticulation: 0.92, tension: 0.72, release: 0.18, drumMix: 0.94, synthMix: 0.9 },
  dnb: { rhythm: 'breakbeat', bass: 'reese', melody: 'contour', syncopation: 'urgent', timbre: 'razor', progression: [0, 3, 4, 6], arrangement: 'pressure', swing: 0.06, phraseLength: 8, leadOctave: 5, bassOctave: 2, leadArticulation: 0.78, bassArticulation: 0.9, tension: 0.6, release: 0.2, drumMix: 0.96, synthMix: 0.82 },
  jungle: { rhythm: 'breakbeat', bass: 'minorSync', melody: 'chopped', syncopation: 'jungle', timbre: 'tapeBreak', progression: [0, 5, 3, 4], arrangement: 'pressure', swing: 0.14, phraseLength: 4, leadOctave: 5, bassOctave: 2, leadArticulation: 0.82, bassArticulation: 0.94, tension: 0.62, release: 0.28, drumMix: 0.98, synthMix: 0.76 },
  generative: { rhythm: 'adaptive', bass: 'wandering', melody: 'contour', syncopation: 'probabilistic', timbre: 'mutable', progression: [0, 3, 5, 2], arrangement: 'generative', swing: 0.08, phraseLength: 8, leadOctave: 5, bassOctave: 2, leadArticulation: 0.62, bassArticulation: 0.72, tension: 0.34, release: 0.22, drumMix: 0.82, synthMix: 0.84 },
  dark: { rhythm: 'broken', bass: 'pedal', melody: 'stabs', syncopation: 'lurch', timbre: 'shadow', progression: [0, 1, 5, 0], arrangement: 'slowArc', swing: 0.11, phraseLength: 8, leadOctave: 4, bassOctave: 1, leadArticulation: 0.48, bassArticulation: 0.84, tension: 0.68, release: 0.16, drumMix: 0.78, synthMix: 0.86 },
});

const SYNCOPATION = Object.freeze({
  loose: [0.18, 0.3, 0.22, 0.38],
  laidBack: [0.1, 0.28, 0.12, 0.34],
  offbeat: [0.04, 0.72, 0.05, 0.68],
  driving: [0.2, 0.48, 0.22, 0.56],
  uplift: [0.12, 0.62, 0.18, 0.7],
  lurch: [0.08, 0.52, 0.34, 0.72],
  urgent: [0.34, 0.72, 0.42, 0.78],
  jungle: [0.22, 0.82, 0.48, 0.9],
  probabilistic: [0.24, 0.46, 0.32, 0.58],
});

const MELODY_VOCABULARIES = Object.freeze({
  floating: ({ step, chord, phrase }) => chord + Math.round(Math.sin((step + phrase * 3) * Math.PI / 8) * 2) + (step % 5 === 0 ? 4 : 0),
  contour: ({ step, chord, phrase }) => chord + [0, 2, 4, 3, 5, 2, 1, 4][(step + phrase) % 8],
  chordal: ({ step, chord }) => chord + [0, 2, 4, 2][Math.floor(step / 2) % 4],
  minimal: ({ step, chord, bar }) => chord + ((step + bar) % 7 === 0 ? 4 : 0),
  acid: ({ step, chord, phrase }) => chord + ((step * 3 + phrase) % 7),
  arpeggio: ({ step, chord }) => chord + [0, 2, 4, 6][step % 4],
  stabs: ({ step, chord }) => chord + (step % 6 === 0 ? 5 : 0),
  chopped: ({ step, chord, bar }) => chord + [0, 4, 2, 6, 3, 1, 5, 2][(step * 3 + bar) % 8],
});

const BASS_VOCABULARIES = Object.freeze({
  pedal: ({ chord }) => chord,
  warm: ({ chord, beat }) => chord + (beat === 3 ? 4 : 0),
  offbeat: ({ chord, step }) => chord + (step % 8 === 6 ? 4 : 0),
  pulse: ({ chord, bar }) => chord + (bar % 4 === 3 ? 3 : 0),
  acid: ({ chord, step }) => chord + [0, 0, 3, 4][Math.floor(step / 4) % 4],
  reese: ({ chord, beat }) => chord + [0, 0, 3, 1][beat % 4],
  minorSync: ({ chord, step, bar }) => chord + [0, 3, 4, 6][(Math.floor(step / 2) + bar) % 4],
  wandering: ({ chord, beat, bar }) => chord + ((beat + bar) % 5),
});

function rhythmEvents(name, { step, bar, density, random }) {
  const beat = Math.floor(step / 4);
  const offbeat = step % 4 === 2;
  const events = { kick: false, snare: false, hat: false };
  if (name === 'fourFloor') {
    events.kick = step % 4 === 0;
    events.snare = step === 4 || step === 12;
    events.hat = offbeat || (density > 0.74 && step % 2 === 1);
  } else if (name === 'breakbeat') {
    events.kick = step === 0 || step === 7 || (bar % 2 === 0 ? step === 10 : step === 3);
    events.snare = step === 4 || step === 12 || (density > 0.82 && step === 15);
    events.hat = step % 2 === 1 || (density > 0.76 && step % 4 === 2);
  } else if (name === 'halfTime') {
    events.kick = step === 0 || step === 10;
    events.snare = step === 8;
    events.hat = step % 4 === 2 || (density > 0.7 && step % 2 === 1);
  } else if (name === 'backbeat') {
    events.kick = step === 0 || step === 8;
    events.snare = step === 4 || step === 12;
    events.hat = offbeat;
  } else if (name === 'sparse') {
    events.kick = step === 0 && bar % 2 === 0;
    events.hat = density > 0.52 && step === 10;
  } else if (name === 'broken') {
    events.kick = step === 0 || step === 6 || step === 11;
    events.snare = step === 4 || step === 12;
    events.hat = step === 2 || step === 9 || step === 14;
  } else {
    events.kick = step === 0 || (density > 0.58 && step === 8);
    events.snare = step === 4 || step === 12;
    events.hat = offbeat || random < density * 0.22;
  }
  return events;
}

function mutateDegree(degree, strength, random) {
  if (random >= strength) return degree;
  const distance = 1 + Math.floor(((random / Math.max(strength, 0.001)) * 17) % 3);
  return degree + (random > strength * 0.5 ? distance : -distance);
}

export function recipeForState(state) {
  const scene = SCENE_GRAMMAR[state.scene] || SCENE_GRAMMAR.generative;
  const useOverrides = state.grammarScene === state.scene;
  return {
    ...scene,
    rhythm: useOverrides && state.rhythmGrammar ? state.rhythmGrammar : scene.rhythm,
    bass: useOverrides && state.bassGrammar ? state.bassGrammar : scene.bass,
    melody: useOverrides && state.melodyGrammar ? state.melodyGrammar : scene.melody,
    syncopation: useOverrides && state.syncopationProfile ? state.syncopationProfile : scene.syncopation,
    timbre: useOverrides && state.timbrePreset ? state.timbrePreset : scene.timbre,
    progression: useOverrides && state.chordProgression?.length ? state.chordProgression : scene.progression,
  };
}

export function composePattern(state, step, bar, randoms = {}) {
  const recipe = recipeForState(state);
  const section = SECTION_PROFILES[state.section] || SECTION_PROFILES.verse;
  const density = clamp((state.density ?? 0.5) * section.density);
  const energy = clamp((state.energy ?? 0.5) * section.energy);
  const tension = clamp((state.tension ?? 0.3) + section.tension - (state.release ?? 0.2) * 0.22);
  const phraseLength = Math.max(1, state.phraseLength || 8);
  const phrase = Math.floor(bar / phraseLength);
  const chord = Number.isFinite(state.currentChordSemitone)
    ? 0
    : Number.isFinite(state.currentChordDegree)
    ? state.currentChordDegree
    : recipe.progression[Math.floor((bar % phraseLength) * recipe.progression.length / phraseLength) % recipe.progression.length];
  const beat = Math.floor(step / 4);
  const sync = SYNCOPATION[recipe.syncopation] || SYNCOPATION.probabilistic;
  const laneMutation = state.mutation || {};
  const context = { step, bar, beat, phrase, chord };
  const melodyFn = MELODY_VOCABULARIES[recipe.melody] || MELODY_VOCABULARIES.contour;
  const bassFn = BASS_VOCABULARIES[recipe.bass] || BASS_VOCABULARIES.wandering;
  let leadDegree = melodyFn(context);
  let bassDegree = bassFn(context);
  leadDegree = mutateDegree(leadDegree, clamp(laneMutation.lead ?? state.chaos ?? 0.2), randoms.lead ?? 1);
  bassDegree = mutateDegree(bassDegree, clamp(laneMutation.bass ?? (state.chaos ?? 0.2) * 0.6), randoms.bass ?? 1);
  if ((randoms.harmony ?? 1) < clamp(laneMutation.harmony ?? 0.08) * tension) leadDegree += 1;
  const rhythm = rhythmEvents(recipe.rhythm, { step, bar, density, random: randoms.drums ?? 1 });
  const drumMutation = clamp(laneMutation.drums ?? state.chaos ?? 0.2) * 0.24;
  if ((randoms.drums ?? 1) < drumMutation) rhythm[['kick', 'snare', 'hat'][(step + bar) % 3]] = true;
  return {
    recipe,
    rhythm,
    leadDegree,
    bassDegree,
    leadChance: clamp((0.1 + density * 0.7) * (0.62 + (state.leadArticulation ?? 0.6) * 0.65) + sync[step % 4] * 0.12),
    bassChance: clamp((0.38 + density * 0.48) * (0.55 + (state.bassArticulation ?? 0.7) * 0.55) + sync[step % 4] * 0.15),
    drumLevel: clamp((state.drumMix ?? 0.8) * section.drums),
    energy,
    tension,
  };
}

export function sceneArrangement(sceneName) {
  const recipe = SCENE_GRAMMAR[sceneName] || SCENE_GRAMMAR.generative;
  return ARRANGEMENTS[recipe.arrangement] || ARRANGEMENTS.generative;
}

export function sceneGrammarState(sceneName) {
  const recipe = SCENE_GRAMMAR[sceneName] || SCENE_GRAMMAR.generative;
  const [section, bars] = sceneArrangement(sceneName)[0];
  return {
    grammarScene: sceneName,
    chordProgression: [...recipe.progression],
    currentChordDegree: recipe.progression[0],
    rhythmGrammar: recipe.rhythm,
    bassGrammar: recipe.bass,
    melodyGrammar: recipe.melody,
    syncopationProfile: recipe.syncopation,
    timbrePreset: recipe.timbre,
    section,
    sectionIndex: 0,
    sectionBars: bars,
    sectionBarsRemaining: bars,
    arrangementBar: 0,
    swing: recipe.swing,
    phraseLength: recipe.phraseLength,
    leadOctave: recipe.leadOctave,
    bassOctave: recipe.bassOctave,
    leadArticulation: recipe.leadArticulation,
    bassArticulation: recipe.bassArticulation,
    tension: recipe.tension,
    release: recipe.release,
    drumMix: recipe.drumMix,
    synthMix: recipe.synthMix,
  };
}

export function advanceArrangement(state) {
  const arrangement = sceneArrangement(state.scene);
  state.arrangementBar = (state.arrangementBar || 0) + 1;
  state.sectionBarsRemaining = Math.max(0, (state.sectionBarsRemaining || 1) - 1);
  if (state.sectionBarsRemaining === 0) {
    state.sectionIndex = ((state.sectionIndex || 0) + 1) % arrangement.length;
    const [section, bars] = arrangement[state.sectionIndex];
    state.section = section;
    state.sectionBars = bars;
    state.sectionBarsRemaining = bars;
  }
  const influenceProgression = state.influenceProgressions?.[state.section]
    || state.influenceProgressions?.default;
  const progression = influenceProgression?.length
    ? influenceProgression
    : state.chordProgression?.length ? state.chordProgression : [0];
  const phraseLength = Math.max(1, state.phraseLength || 8);
  const chordIndex = Math.floor((state.arrangementBar % phraseLength) * progression.length / phraseLength) % progression.length;
  if (influenceProgression?.length) {
    const current = progression[chordIndex];
    state.currentChordSemitone = current.semitone;
    state.currentChordQuality = current.quality || '';
    state.currentChordBassSemitone = current.bass;
  } else {
    state.currentChordDegree = progression[chordIndex];
    state.currentChordSemitone = null;
    state.currentChordQuality = '';
    state.currentChordBassSemitone = null;
  }
  return state;
}

export const __test = { ARRANGEMENTS, SYNCOPATION, MELODY_VOCABULARIES, BASS_VOCABULARIES, rhythmEvents, mutateDegree };
