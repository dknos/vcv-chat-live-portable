import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_STATE } from '../src/music.js';
import { SCENE_GRAMMAR, advanceArrangement, composePattern, recipeForState, sceneGrammarState } from '../src/pattern-grammar.js';

test('scene recipes compose independent rhythm, bass, melody, syncopation, and timbre vocabularies', () => {
  const jungle = SCENE_GRAMMAR.jungle;
  assert.deepEqual(
    [jungle.rhythm, jungle.bass, jungle.melody, jungle.syncopation, jungle.timbre],
    ['breakbeat', 'minorSync', 'chopped', 'jungle', 'tapeBreak'],
  );
  const override = recipeForState({ ...INITIAL_STATE, ...sceneGrammarState('jungle'), scene: 'jungle', bassGrammar: 'pedal' });
  assert.equal(override.rhythm, 'breakbeat');
  assert.equal(override.bass, 'pedal');
});

test('pattern composition is deterministic and lane mutation is isolated', () => {
  const state = { ...INITIAL_STATE, ...sceneGrammarState('jungle'), scene: 'jungle', mutation: { ...INITIAL_STATE.mutation, lead: 0 } };
  const randoms = { lead: 0.1, bass: 0.2, drums: 0.3, harmony: 0.4 };
  const first = composePattern(state, 7, 3, randoms);
  assert.deepEqual(first, composePattern(state, 7, 3, randoms));
  const leadMutated = composePattern({ ...state, mutation: { ...state.mutation, lead: 1 } }, 7, 3, randoms);
  const drumsMutated = composePattern({ ...state, mutation: { ...state.mutation, drums: 1 } }, 7, 3, randoms);
  assert.notEqual(leadMutated.leadDegree, first.leadDegree);
  assert.equal(drumsMutated.leadDegree, first.leadDegree);
});

test('arrangement state advances sections and harmony with bars remaining', () => {
  const state = { ...INITIAL_STATE, ...sceneGrammarState('house'), scene: 'house', phraseLength: 4 };
  const initialSection = state.section;
  const initialChord = state.currentChordDegree;
  advanceArrangement(state);
  assert.equal(state.sectionBarsRemaining, state.sectionBars - 1);
  assert.notEqual(state.currentChordDegree, initialChord);
  while (state.section === initialSection) advanceArrangement(state);
  assert.notEqual(state.section, initialSection);
  assert.ok(state.sectionBarsRemaining > 0);
});
