import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';

function paddedLength(length) {
  return Math.ceil(length / 4) * 4;
}

function oscString(value) {
  const data = Buffer.from(`${value}\0`, 'utf8');
  const output = Buffer.alloc(paddedLength(data.length));
  data.copy(output);
  return output;
}

export function encodeOscMessage(address, value) {
  if (!/^\/[A-Za-z0-9_\-/]+$/.test(address)) {
    throw new Error(`invalid OSC address: ${address}`);
  }
  if (!Number.isFinite(value)) throw new Error('OSC value must be a finite number');
  const argument = Buffer.alloc(4);
  argument.writeFloatBE(value, 0);
  return Buffer.concat([oscString(address), oscString(',f'), argument]);
}

function joinAddress(namespace, control) {
  if (!/^[A-Za-z0-9_-]+$/.test(control)) throw new Error(`invalid OSC control: ${control}`);
  return `${namespace}/${control}`.replace(/\/{2,}/g, '/');
}

export class OscClient extends EventEmitter {
  constructor({ host, port, namespace = '/chat', dryRun = false, logger = console }) {
    super();
    this.host = host;
    this.port = port;
    this.namespace = namespace;
    this.dryRun = dryRun;
    this.logger = logger;
    this.socket = dryRun ? null : dgram.createSocket('udp4');
    this.closed = false;
    if (this.socket) {
      this.socket.on('error', (error) => this.emit('error', error));
    }
  }

  async send(control, value) {
    if (this.closed) throw new Error('OSC client is closed');
    const address = joinAddress(this.namespace, control);
    const packet = encodeOscMessage(address, value);
    const sent = { address, value, host: this.host, port: this.port };
    this.emit('send', sent);
    if (this.dryRun) {
      this.logger.log(`[osc:dry] ${address} ${Number(value).toFixed(4)}`);
      return sent;
    }
    await new Promise((resolve, reject) => {
      this.socket.send(packet, this.port, this.host, (error) => (error ? reject(error) : resolve()));
    });
    return sent;
  }

  async sendMany(entries) {
    for (const [control, value] of entries) {
      await this.send(control, value);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.socket) this.socket.close();
  }
}

export const __test = { paddedLength, oscString, joinAddress };
