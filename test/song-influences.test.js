import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_STATE, parseChatCommand } from '../src/music.js';
import { advanceArrangement } from '../src/pattern-grammar.js';
import { resolveSongInfluence } from '../src/song-influences.js';

test('song influence aliases resolve to portable generative presets', () => {
  assert.equal(resolveSongInfluence('Free Bird').id, 'freebird');
  assert.equal(resolveSongInfluence('jubileestomp').id, 'jubileestomp');
  assert.equal(resolveSongInfluence('Led Zeppelin - Stairway to Heaven').id, 'stairwaytoheaven');
  assert.equal(resolveSongInfluence('stairway').id, 'stairwaytoheaven');
  assert.equal(resolveSongInfluence('Another One Bites the Dust').id, 'anotheronebitesthedust');
  assert.equal(resolveSongInfluence('bohemian').id, 'bohemianrhapsody');
  assert.equal(resolveSongInfluence('Beethoven Moonlight Sonata').id, 'moonlightsonata');
  assert.equal(resolveSongInfluence('The Beatles Hey Jude').id, 'heyjude');
  assert.equal(resolveSongInfluence('mario').id, 'supermario');
  assert.equal(resolveSongInfluence('Bobby Hebb Sunny').id, 'sunny');
});

test('influence command configures harmony, form, and instruments', () => {
  const freebird = parseChatCommand('!influence freebird');
  assert.equal(freebird.ok, true);
  assert.equal(freebird.action.changes.root, 7);
  assert.equal(freebird.action.changes.tempo, 117);
  assert.equal(freebird.action.changes.guitar, true);
  assert.equal(freebird.action.changes.influenceTitle, 'Free Bird');
  assert.deepEqual(
    freebird.action.changes.influenceProgressions.drop.map(({ semitone }) => semitone),
    [0, 3, 5, 5],
  );

  assert.equal(parseChatCommand('!jubilee stomp').action.changes.influenceTitle, 'Jubilee Stomp');
  assert.equal(parseChatCommand('!stairway to heaven').action.changes.influenceTitle, 'Stairway to Heaven');
  assert.equal(parseChatCommand('!influence unknown song').ok, false);
  assert.equal(parseChatCommand('!influence another one bites the dust').action.changes.tempo, 110);
  assert.equal(parseChatCommand('!influence bohemian rhapsody').action.changes.influenceArtist, 'Queen');
  assert.equal(parseChatCommand('!influence moonlight sonata').action.changes.pianoMix, 1);
  assert.deepEqual(
    parseChatCommand('!influence hey jude').action.changes.influenceProgressions.outro.map(({ semitone }) => semitone),
    [10, 5, 0, 0],
  );
  assert.equal(parseChatCommand('!influence super mario').action.changes.swing, 0.22);
  assert.equal(parseChatCommand('!influence sunny').action.changes.scale, 'minor');
});

test('arrangement selects chromatic progressions for each influence section', () => {
  const preset = resolveSongInfluence('free bird');
  const state = { ...INITIAL_STATE, ...preset.changes, section: 'drop', arrangementBar: 1, sectionBarsRemaining: 8 };
  advanceArrangement(state);
  assert.equal(state.currentChordSemitone, 3);
  assert.equal(state.currentChordQuality, '');

  const verse = { ...INITIAL_STATE, ...preset.changes, section: 'verse', arrangementBar: 1, sectionBarsRemaining: 8 };
  advanceArrangement(verse);
  assert.equal(verse.currentChordSemitone, 7);
  assert.equal(verse.currentChordBassSemitone, 11);
});
