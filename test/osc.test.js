import assert from 'node:assert/strict';
import test from 'node:test';

import { OscClient, encodeOscMessage } from '../src/osc.js';

function readOscString(buffer, offset = 0) {
  const end = buffer.indexOf(0, offset);
  const value = buffer.toString('utf8', offset, end);
  const next = Math.ceil((end + 1) / 4) * 4;
  return { value, next };
}

test('OSC encoder writes a standards-compliant float message', () => {
  const packet = encodeOscMessage('/chat/energy', 7.5);
  const address = readOscString(packet);
  const type = readOscString(packet, address.next);
  assert.equal(address.value, '/chat/energy');
  assert.equal(type.value, ',f');
  assert.equal(packet.readFloatBE(type.next), 7.5);
  assert.equal(packet.length % 4, 0);
});

test('OSC encoder rejects hostile addresses and non-finite values', () => {
  assert.throws(() => encodeOscMessage('/chat/../../oops', 1), /invalid OSC address/);
  assert.throws(() => encodeOscMessage('/chat/energy', Number.NaN), /finite/);
});

test('dry-run client records normalized control addresses without UDP', async () => {
  const log = [];
  const sent = [];
  const client = new OscClient({
    host: '127.0.0.1',
    port: 7001,
    namespace: '/chat',
    dryRun: true,
    logger: { log: (line) => log.push(line) },
  });
  client.on('send', (item) => sent.push(item));
  await client.send('brightness', 4.25);
  assert.equal(sent[0].address, '/chat/brightness');
  assert.match(log[0], /4\.2500/);
  client.close();
});
