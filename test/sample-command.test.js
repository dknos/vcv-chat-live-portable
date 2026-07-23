import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSampleRequest, __test } from '../src/sample-command.js';

test('sample command accepts direct and scoped YouTube requests', () => {
  assert.deepEqual(extractSampleRequest('!sample https://youtu.be/abc123'), {
    ok: true,
    url: 'https://youtu.be/abc123',
    start: 0,
  });
  assert.deepEqual(extractSampleRequest('!rack sample https://www.youtube.com/watch?v=abc123 1:23'), {
    ok: true,
    url: 'https://www.youtube.com/watch?v=abc123',
    start: 83,
  });
  assert.deepEqual(extractSampleRequest('!sample https://music.youtube.com/watch?v=abc123 at 1:02:03.5'), {
    ok: true,
    url: 'https://music.youtube.com/watch?v=abc123',
    start: 3723.5,
  });
  assert.deepEqual(extractSampleRequest('!sample etviGf1uWlg 40s'), {
    ok: true,
    url: 'https://www.youtube.com/watch?v=etviGf1uWlg',
    start: 40,
  });
});

test('sample command ignores ordinary chat and rejects unsafe sources', () => {
  assert.equal(extractSampleRequest('ordinary chat'), null);
  assert.equal(extractSampleRequest('!sample http://youtu.be/abc').ok, false);
  assert.equal(extractSampleRequest('!sample https://example.com/audio 10').ok, false);
  assert.equal(extractSampleRequest('!sample https://youtube.com/watch?v=abc 9:99:99:99').ok, false);
  assert.equal(extractSampleRequest('!sample https://youtube.com/watch?v=abc 21601').ok, false);
});

test('sample time parser supports seconds and clock notation', () => {
  assert.equal(__test.parseTime('12.5'), 12.5);
  assert.equal(__test.parseTime('40s'), 40);
  assert.equal(__test.parseTime('2:03'), 123);
  assert.equal(__test.parseTime('1:02:03.5'), 3723.5);
  assert.equal(__test.parseTime('nope'), null);
});
