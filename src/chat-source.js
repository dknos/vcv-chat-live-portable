import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import readline from 'node:readline';

export function normalizeTimestamp(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1e18) return Math.round(value / 1e6); // nanoseconds
  if (value >= 1e15) return Math.round(value / 1e3); // microseconds
  if (value >= 1e12) return Math.round(value); // milliseconds
  if (value >= 1e9) return Math.round(value * 1e3); // seconds
  return 0;
}

function fingerprint(message) {
  if (message.id) return String(message.id);
  return crypto
    .createHash('sha256')
    .update(`${message.channelId || message.name || ''}\0${message.text || ''}\0${message.rawTimestamp || message.ts || ''}`)
    .digest('hex');
}

function normalizeMessage(raw) {
  if (!raw || typeof raw.text !== 'string') return null;
  const rawTimestamp = raw.ts ?? raw.publishedAt ?? raw.timestamp;
  return {
    id: raw.id ? String(raw.id) : '',
    name: String(raw.name || raw.displayName || 'viewer').slice(0, 100),
    channelId: String(raw.channelId || raw.authorChannelId || ''),
    text: raw.text.slice(0, 500),
    ts: normalizeTimestamp(rawTimestamp),
    rawTimestamp,
    isOwner: !!(raw.isOwner || raw.isChatOwner),
    isModerator: !!(raw.isModerator || raw.isChatModerator),
    isMember: !!(raw.isMember || raw.isChatSponsor),
  };
}

class SeenSet {
  constructor(max = 2000) {
    this.max = max;
    this.values = new Map();
  }

  has(value) {
    return this.values.has(value);
  }

  add(value) {
    this.values.set(value, true);
    if (this.values.size > this.max) {
      const oldest = this.values.keys().next().value;
      this.values.delete(oldest);
    }
  }
}

export class SessionChatSource extends EventEmitter {
  constructor({ file, pollMs = 1000, startupGraceMs = 0, staleMs = 60_000, onMessage, logger = console }) {
    super();
    this.file = file;
    this.pollMs = pollMs;
    this.startupCutoff = Date.now() - startupGraceMs;
    this.staleMs = staleMs;
    this.onMessage = onMessage;
    this.logger = logger;
    this.seen = new SeenSet();
    this.timer = null;
    this.primed = false;
    this.running = false;
    this.processing = Promise.resolve();
    this.lastFileError = '';
  }

  async readSession() {
    const [text, stat] = await Promise.all([fs.readFile(this.file, 'utf8'), fs.stat(this.file)]);
    const data = JSON.parse(text);
    const declaredUpdate = Date.parse(data.updatedAt || '');
    return {
      active: data.active !== false,
      messages: Array.isArray(data.chatHistory) ? data.chatHistory : [],
      updatedAt: data.updatedAt || null,
      updatedMs: Number.isFinite(declaredUpdate) ? declaredUpdate : stat.mtimeMs,
    };
  }

  async poll() {
    if (!this.running) return;
    let session;
    try {
      session = await this.readSession();
      if (this.lastFileError) {
        this.lastFileError = '';
        this.emit('status', { ok: true, active: session.active, detail: 'chat feed recovered' });
      }
    } catch (error) {
      const detail = error.code === 'ENOENT' ? 'waiting for chat session file' : error.message;
      if (detail !== this.lastFileError) {
        this.lastFileError = detail;
        this.emit('status', { ok: false, active: false, detail });
      }
      return;
    }

    const messages = session.messages
      .map(normalizeMessage)
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
    const ageMs = Math.max(0, Date.now() - session.updatedMs);
    const stale = ageMs > this.staleMs;
    const active = session.active && !stale;
    const feedDetail = stale
      ? `chat feed stale (${Math.max(1, Math.round(ageMs / 1000))}s old)`
      : 'chat feed connected';

    if (!this.primed) {
      for (const message of messages) this.seen.add(fingerprint(message));
      this.primed = true;
      this.emit('status', {
        ok: true,
        active,
        stale,
        detail: `${feedDetail}; skipped ${messages.length} historical messages`,
      });
      return;
    }

    for (const message of messages) {
      const id = fingerprint(message);
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      if (message.ts && message.ts < this.startupCutoff) continue;
      this.emit('message', message);
      this.processing = this.processing
        .then(() => this.onMessage(message))
        .catch((error) => this.logger.error(`[chat] message failed: ${error.message}`));
    }
    this.emit('status', { ok: true, active, stale, detail: feedDetail });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  async close() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    await this.processing;
  }
}

export class StdinChatSource extends EventEmitter {
  constructor({ onMessage, input = process.stdin, output = process.stdout, logger = console }) {
    super();
    this.onMessage = onMessage;
    this.input = input;
    this.output = output;
    this.logger = logger;
    this.interface = null;
    this.counter = 0;
    this.processing = Promise.resolve();
  }

  parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      return { ...normalizeMessage({ ...parsed, ts: parsed.ts || Date.now() }), trusted: parsed.trusted !== false };
    }
    const match = trimmed.match(/^([^>]{1,60})>\s*(.+)$/);
    return {
      id: `stdin-${++this.counter}`,
      name: match ? match[1].trim() : 'operator',
      channelId: '',
      text: match ? match[2] : trimmed,
      ts: Date.now(),
      trusted: true,
      isOwner: true,
      isModerator: false,
      isMember: false,
    };
  }

  async start() {
    this.interface = readline.createInterface({ input: this.input, output: this.output, terminal: false });
    this.emit('status', { ok: true, active: true, detail: 'stdin simulator ready' });
    this.logger.log('[chat] stdin mode: type `viewer> !rack vibe dark ambient`');
    this.interface.on('line', (line) => {
      this.processing = this.processing
        .then(async () => {
          let message;
          try {
            message = this.parseLine(line);
          } catch (error) {
            this.logger.error(`[chat] bad JSON line: ${error.message}`);
            return;
          }
          if (message) await this.onMessage(message);
          if (message) this.emit('message', message);
        })
        .catch((error) => this.logger.error(`[chat] message failed: ${error.message}`));
    });
  }

  async close() {
    if (this.interface) this.interface.close();
    await this.processing;
  }
}

export const __test = { fingerprint, normalizeMessage, SeenSet };
