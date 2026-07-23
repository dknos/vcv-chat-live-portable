import { EventEmitter } from 'node:events';

import { parseChatCommand } from './music.js';

const PROVIDERS = new Set(['openai-compatible', 'anthropic', 'gemini', 'webhook']);
const DEFAULT_BASE_URLS = Object.freeze({
  'openai-compatible': 'http://127.0.0.1:11434/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
});

const SYSTEM_PROMPT = `You control a bounded live generative-music system.
Return JSON only: {"commands":["!rack command", ...]}.
Return at most the requested number of commands. Use only these command families:
vibe, influence, tempo, key, scale, energy, density, brightness, space, chaos,
scene, chords, swing, phrase, section, octave, articulation, mix, mutate, drums,
drop. Never return image, sample, voice, say, mute, unmute, freeze, unfreeze,
reset, panic, URLs, prose, Markdown, shell commands, or file paths.`;

function cleanText(value, max) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractModelRequest(text, prefix = '!rack', trigger = '!ai') {
  const cleaned = cleanText(text, 500);
  const triggers = [
    new RegExp(`^${escapeRegExp(trigger)}(?:\\s+([\\s\\S]+))?$`, 'i'),
    new RegExp(`^${escapeRegExp(prefix)}\\s+ai(?:\\s+([\\s\\S]+))?$`, 'i'),
  ];
  const match = triggers.map((pattern) => cleaned.match(pattern)).find(Boolean);
  if (!match) return null;
  const prompt = cleanText(match[1], 320);
  if (prompt.length < 3) return { ok: false, error: 'model request needs at least 3 characters' };
  return { ok: true, prompt };
}

function stripCodeFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function commandList(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.commands)) return value.commands;
  return null;
}

export function parseModelCommands(raw, { prefix = '!rack', maxCommands = 4 } = {}) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(stripCodeFence(raw)) : raw;
  } catch {
    throw new Error('model response was not valid JSON');
  }
  const candidates = commandList(parsed);
  if (!candidates?.length) throw new Error('model returned no commands');
  if (candidates.length > maxCommands) throw new Error(`model returned more than ${maxCommands} commands`);

  return candidates.map((candidate) => {
    const value = cleanText(candidate, 240);
    if (!value) throw new Error('model returned an empty command');
    const withoutBang = value.startsWith('!') ? value.slice(1) : value;
    const normalized = withoutBang.toLowerCase().startsWith(`${prefix.slice(1).toLowerCase()} `)
      ? `!${withoutBang}`
      : `${prefix} ${withoutBang}`;
    const result = parseChatCommand(normalized, { prefix, directAliases: false });
    if (!result.matched || !result.ok || result.action.kind === 'admin') {
      throw new Error(`model returned a disallowed command: ${value}`);
    }
    return normalized;
  });
}

function endpoint(baseUrl, suffix) {
  const base = new URL(baseUrl);
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
  return base;
}

function compactState(snapshot) {
  const state = snapshot?.state || {};
  return {
    tempo: state.tempo,
    key: state.rootName,
    scale: state.scale,
    scene: state.scene,
    section: state.section,
    energy: state.energy,
    density: state.density,
    brightness: state.brightness,
    space: state.space,
    chaos: state.chaos,
    drums: state.drums,
  };
}

function responseText(provider, data) {
  if (provider === 'openai-compatible') {
    return data?.choices?.[0]?.message?.content;
  }
  if (provider === 'anthropic') {
    return data?.content?.map((part) => part?.text || '').join('');
  }
  if (provider === 'gemini') {
    return data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('');
  }
  if (provider === 'webhook') {
    if (Array.isArray(data?.commands)) return JSON.stringify({ commands: data.commands });
    return data?.text ?? data?.content;
  }
  return null;
}

export class ModelClient {
  constructor({
    provider,
    baseUrl,
    apiKey = '',
    model,
    timeoutMs = 30_000,
    maxCommands = 4,
    fetchImpl = globalThis.fetch,
  }) {
    if (!PROVIDERS.has(provider)) throw new Error(`unsupported model provider: ${provider}`);
    if (provider !== 'webhook' && !String(model || '').trim()) {
      throw new Error('MODEL_NAME is required when model control is enabled');
    }
    if (provider === 'webhook' && !String(baseUrl || '').trim()) {
      throw new Error('MODEL_BASE_URL is required for the webhook provider');
    }
    this.provider = provider;
    this.baseUrl = baseUrl || DEFAULT_BASE_URLS[provider];
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxCommands = maxCommands;
    this.fetch = fetchImpl;
  }

  requestOptions(prompt, snapshot) {
    const state = compactState(snapshot);
    const user = `Current state: ${JSON.stringify(state)}\nOperator request: ${prompt}`;
    const headers = { 'content-type': 'application/json' };
    let url;
    let body;

    if (this.provider === 'openai-compatible') {
      url = endpoint(this.baseUrl, 'chat/completions');
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      body = {
        model: this.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\nMaximum commands: ${this.maxCommands}.` },
          { role: 'user', content: user },
        ],
      };
    } else if (this.provider === 'anthropic') {
      url = endpoint(this.baseUrl, 'messages');
      headers['anthropic-version'] = '2023-06-01';
      if (this.apiKey) headers['x-api-key'] = this.apiKey;
      body = {
        model: this.model,
        max_tokens: 300,
        temperature: 0.2,
        system: `${SYSTEM_PROMPT}\nMaximum commands: ${this.maxCommands}.`,
        messages: [{ role: 'user', content: user }],
      };
    } else if (this.provider === 'gemini') {
      url = endpoint(this.baseUrl, `models/${encodeURIComponent(this.model)}:generateContent`);
      if (this.apiKey) headers['x-goog-api-key'] = this.apiKey;
      body = {
        systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\nMaximum commands: ${this.maxCommands}.` }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 300, responseMimeType: 'application/json' },
      };
    } else {
      url = new URL(this.baseUrl);
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      body = {
        model: this.model,
        system: `${SYSTEM_PROMPT}\nMaximum commands: ${this.maxCommands}.`,
        prompt,
        state,
        responseSchema: { commands: ['!rack tempo 120'] },
      };
    }
    return { url, headers, body };
  }

  async complete(prompt, snapshot) {
    const { url, headers, body } = this.requestOptions(prompt, snapshot);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('model request timed out');
      throw new Error(`model request failed: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`model provider returned HTTP ${response.status}`);
    const data = await response.json();
    const text = responseText(this.provider, data);
    if (!text) throw new Error('model provider returned no content');
    return text;
  }
}

export class ModelControlService extends EventEmitter {
  constructor({
    enabled = false,
    ownerOnly = true,
    prefix = '!rack',
    trigger = '!ai',
    cooldownMs = 15_000,
    maxCommands = 4,
    client,
    isTrusted,
    getSnapshot,
    applyCommand,
    now = () => Date.now(),
    logger = console,
  }) {
    super();
    this.enabled = enabled;
    this.ownerOnly = ownerOnly;
    this.prefix = prefix;
    this.trigger = trigger;
    this.cooldownMs = cooldownMs;
    this.maxCommands = maxCommands;
    this.client = client;
    this.isTrusted = isTrusted;
    this.getSnapshot = getSnapshot;
    this.applyCommand = applyCommand;
    this.now = now;
    this.logger = logger;
    this.busy = false;
    this.lastAt = Number.NEGATIVE_INFINITY;
  }

  activity(status, message, label, detail = '') {
    this.emit('activity', {
      status,
      author: cleanText(message?.name || 'operator', 48),
      label: cleanText(label, 100),
      detail: cleanText(detail, 140),
    });
  }

  async submit(message) {
    const request = extractModelRequest(message.text, this.prefix, this.trigger);
    if (!request) return false;
    if (!request.ok) {
      this.activity('rejected', message, 'AI control', request.error);
      return true;
    }
    if (!this.enabled || !this.client) {
      this.activity('rejected', message, 'AI control', 'model control is disabled');
      return true;
    }
    if (this.ownerOnly && !this.isTrusted(message)) {
      this.activity('rejected', message, 'AI control', 'owner/mod only');
      return true;
    }
    const remaining = this.lastAt + this.cooldownMs - this.now();
    if (this.busy || remaining > 0) {
      this.activity(
        'rejected',
        message,
        'AI control',
        this.busy ? 'model request already running' : `try again in ${Math.ceil(remaining / 1000)}s`,
      );
      return true;
    }

    this.busy = true;
    this.lastAt = this.now();
    this.emit('status', { ok: true, active: true, detail: 'model request running' });
    this.activity('queued', message, `AI: ${request.prompt}`, 'asking configured model');
    try {
      const raw = await this.client.complete(request.prompt, this.getSnapshot());
      const commands = parseModelCommands(raw, { prefix: this.prefix, maxCommands: this.maxCommands });
      const results = [];
      for (const [index, command] of commands.entries()) {
        results.push(await this.applyCommand({
          ...message,
          id: `${message.id || `model-${this.lastAt}`}:${index}`,
          name: `AI for ${cleanText(message.name || 'operator', 40)}`,
          text: command,
          trusted: true,
          isOwner: true,
          isModerator: false,
        }));
      }
      this.activity('applied', message, `AI control`, commands.join(' | '));
      this.emit('commands', { author: message.name, prompt: request.prompt, commands, results });
      this.emit('status', { ok: true, active: false, detail: 'model control ready' });
    } catch (error) {
      this.logger.error(`[model] ${error.message}`);
      this.activity('rejected', message, 'AI control', error.message);
      this.emit('status', { ok: false, active: false, detail: error.message });
    } finally {
      this.busy = false;
    }
    return true;
  }
}

export const __test = { SYSTEM_PROMPT, compactState, endpoint, responseText };
