import assert from 'node:assert/strict';
import test from 'node:test';
import { extractVoiceRequest, extractVoiceSelect } from '../src/tts-command.js';

test('voice commands accept one to three named voice phrases', () => {
  assert.deepEqual(extractVoiceRequest('!say harune: the signal is dreaming | trickster: wake up'), {
    ok: true,
    segments: [
      { voice: 'harune', text: 'the signal is dreaming' },
      { voice: 'trickster', text: 'wake up' },
    ],
  });
  assert.deepEqual(extractVoiceRequest('!rack say hello from the wire', '!rack', 'cute'), {
    ok: true,
    segments: [{ voice: 'cute', text: 'hello from the wire' }],
  });
});

test('voice commands reject unknown voices and expose a safe selector', () => {
  assert.equal(extractVoiceRequest('normal chat'), null);
  assert.equal(extractVoiceRequest('!say alien: hello').ok, false);
  assert.deepEqual(extractVoiceSelect('!voice harune'), { ok: true, voice: 'harune' });
  assert.equal(extractVoiceSelect('!rack voice alien', '!rack').ok, false);
});
