import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const VOICES = Object.freeze({
  harune: { id: 'c2XJrw7TvNGtOc6r0ijG', label: 'HARUNE', rate: 1.0, detune: 0 },
  lia: { id: 'u6a6bRv82Zfi9NzoIqvt', label: 'LIA', rate: 1.0, detune: -15 },
  cute: { id: 'cgSgspJ2msm6clMCkdW9', label: 'CUTE', rate: 1.04, detune: 25 },
  trickster: { id: 'N2lVS1w4EtoT3dr4eOWO', label: 'TRICKSTER', rate: 0.94, detune: -35 },
  warrior: { id: 'SOYHLrjzK2X1ezoPC6cr', label: 'WARRIOR', rate: 0.9, detune: -65 },
});

function clean(value, max = 180) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function extractVoiceRequest(text, prefix = '!rack', defaultVoice = 'harune') {
  const input = clean(text, 420);
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = input.match(/^!say\s+(.+)$/i) || input.match(new RegExp(`^${escapedPrefix}\\s+say\\s+(.+)$`, 'i'));
  if (!match) return null;
  const parts = match[1].split('|').map((part) => clean(part, 180)).filter(Boolean);
  if (!parts.length) return { ok: false, error: 'use !say voice: your phrase' };
  if (parts.length > 3) return { ok: false, error: 'up to 3 voice phrases at once' };
  const segments = [];
  for (const part of parts) {
    const named = part.match(/^([a-z]+)\s*:\s*(.+)$/i);
    const voice = (named ? named[1] : defaultVoice).toLowerCase();
    const phrase = clean(named ? named[2] : part, 120);
    if (!VOICES[voice]) return { ok: false, error: `voice must be ${Object.keys(VOICES).join(', ')}` };
    if (!phrase) return { ok: false, error: 'each voice phrase needs text' };
    segments.push({ voice, text: phrase });
  }
  return { ok: true, segments };
}

export function extractVoiceSelect(text, prefix = '!rack') {
  const input = clean(text, 120);
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = input.match(/^!voice\s+([a-z]+)$/i) || input.match(new RegExp(`^${escapedPrefix}\\s+voice\\s+([a-z]+)$`, 'i'));
  if (!match) return null;
  const voice = match[1].toLowerCase();
  return VOICES[voice] ? { ok: true, voice } : { ok: false, error: `voice must be ${Object.keys(VOICES).join(', ')}` };
}

function run(command, args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('voice transcode timed out')); }, timeoutMs);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`voice transcode exited ${code}: ${output.slice(-500)}`));
    });
  });
}

export class TtsCommandService extends EventEmitter {
  constructor({ apiKey = '', outputDir, linuxOutputDir, throughWsl = process.platform === 'win32', wslDistro = 'Ubuntu-22.04', ffmpegPath = 'ffmpeg', modelId = 'eleven_multilingual_v2', cooldownMs = 30_000, ownerOnly = true, isTrusted = () => false, logger = console }) {
    super();
    this.apiKey = apiKey;
    this.outputDir = outputDir;
    this.linuxOutputDir = linuxOutputDir;
    this.throughWsl = throughWsl;
    this.wslDistro = wslDistro;
    this.ffmpegPath = ffmpegPath;
    this.modelId = modelId;
    this.cooldownMs = cooldownMs;
    this.ownerOnly = ownerOnly;
    this.isTrusted = isTrusted;
    this.logger = logger;
    this.selectedVoice = 'harune';
    this.busy = false;
    this.lastAt = 0;
  }

  command(tool, args, timeoutMs) {
    if (!this.throughWsl) return run(tool, args, timeoutMs);
    return run('wsl.exe', ['-d', this.wslDistro, '--', 'env', 'PATH=/usr/local/bin:/usr/bin:/bin', tool, ...args], timeoutMs);
  }

  async pruneVoices(keep = 20) {
    const entries = await fs.readdir(this.outputDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && /^chat-voice-\d+-\d+\.wav$/.test(entry.name))
      .map((entry) => entry.name).sort().reverse();
    await Promise.all(files.slice(keep).map((name) => fs.unlink(path.join(this.outputDir, name)).catch(() => {})));
  }

  async synthesize(segment, id, index) {
    const voice = VOICES[segment.voice];
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': this.apiKey },
      body: JSON.stringify({
        text: segment.text,
        model_id: this.modelId,
        voice_settings: { stability: 0.44, similarity_boost: 0.72, style: 0.34, use_speaker_boost: true },
      }),
    });
    if (!response.ok) throw new Error(`ElevenLabs request failed (${response.status})`);
    const filename = `chat-voice-${id}-${index}.wav`;
    const rawName = `.chat-voice-${id}-${index}.mp3`;
    const raw = path.join(this.outputDir, rawName);
    const finalLinux = `${this.linuxOutputDir.replace(/\/$/, '')}/${filename}`;
    await fs.writeFile(raw, Buffer.from(await response.arrayBuffer()));
    try {
      await this.command(this.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', `${this.linuxOutputDir.replace(/\/$/, '')}/${rawName}`,
        '-ar', '48000', '-ac', '2', '-af', 'loudnorm=I=-21:TP=-2:LRA=5,highpass=f=90,lowpass=f=8500', finalLinux,
      ]);
    } finally {
      await fs.unlink(raw).catch(() => {});
    }
    return { url: `/samples/${filename}`, voice: segment.voice, label: voice.label, rate: voice.rate, detune: voice.detune };
  }

  async submit(message, prefix) {
    const select = extractVoiceSelect(message.text, prefix);
    const author = clean(message.name || 'viewer', 48);
    if (select) {
      if (this.ownerOnly && !this.isTrusted(message)) {
        this.emit('activity', { status: 'rejected', author, label: 'voice select', detail: 'owner/mod only' });
      } else if (!select.ok) {
        this.emit('activity', { status: 'rejected', author, label: 'voice select', detail: select.error });
      } else {
        this.selectedVoice = select.voice;
        this.emit('activity', { status: 'applied', author, label: 'voice select', detail: VOICES[select.voice].label });
      }
      return true;
    }
    const parsed = extractVoiceRequest(message.text, prefix, this.selectedVoice);
    if (!parsed) return false;
    if (!parsed.ok) {
      this.emit('activity', { status: 'rejected', author, label: 'voice phrase', detail: parsed.error });
      return true;
    }
    if (this.ownerOnly && !this.isTrusted(message)) {
      this.emit('activity', { status: 'rejected', author, label: 'voice phrase', detail: 'owner/mod only' });
      return true;
    }
    if (!this.apiKey) {
      this.emit('activity', { status: 'rejected', author, label: 'voice phrase', detail: 'ElevenLabs key unavailable' });
      return true;
    }
    const remaining = this.lastAt + this.cooldownMs - Date.now();
    if (this.busy || remaining > 0) {
      this.emit('activity', { status: 'rejected', author, label: 'voice phrase', detail: this.busy ? 'voice engine busy' : `try again in ${Math.ceil(remaining / 1000)}s` });
      return true;
    }
    this.busy = true;
    this.lastAt = Date.now();
    const id = Date.now();
    this.emit('activity', { status: 'queued', author, label: 'voice stem', detail: `${parsed.segments.length} phrase${parsed.segments.length === 1 ? '' : 's'} queued` });
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      const segments = [];
      for (let index = 0; index < parsed.segments.length; index += 1) segments.push(await this.synthesize(parsed.segments[index], id, index));
      this.emit('voice', { author, segments, repeats: 2 });
      this.emit('activity', { status: 'applied', author, label: 'voice stem', detail: 'shaped and looped twice' });
      await this.pruneVoices();
    } catch (error) {
      this.logger.error(`[voice] ${error.message}`);
      this.emit('activity', { status: 'rejected', author, label: 'voice phrase', detail: 'ElevenLabs or transcode failed' });
    } finally {
      this.busy = false;
    }
    return true;
  }
}

export const __test = { clean, VOICES };
