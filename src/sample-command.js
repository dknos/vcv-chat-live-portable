import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be']);

function clean(value, max = 180) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseTime(value) {
  const raw = String(value || '').trim().replace(/s$/i, '');
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const parts = raw.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length < 2 || parts.length > 3) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

export function extractSampleRequest(text, prefix = '!rack') {
  const input = clean(text, 300);
  const scoped = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+sample\\s+(.+)$`, 'i');
  const match = input.match(/^!sample\s+(.+)$/i) || input.match(scoped);
  if (!match) return null;
  const request = match[1].trim();
  const urlMatch = request.match(/^(https:\/\/\S+?|[A-Za-z0-9_-]{11})(?:\s+(?:at\s+)?([0-9:.]+s?))?$/i);
  if (!urlMatch) return { ok: false, error: 'use !sample <video-id-or-youtube-url> [start time]' };
  let url;
  const source = /^[A-Za-z0-9_-]{11}$/.test(urlMatch[1])
    ? `https://www.youtube.com/watch?v=${urlMatch[1]}`
    : urlMatch[1];
  try { url = new URL(source); } catch { return { ok: false, error: 'invalid YouTube URL or video ID' }; }
  if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, error: 'samples must use a YouTube URL' };
  }
  const start = parseTime(urlMatch[2]);
  if (start === null || start < 0 || start > 21_600) return { ok: false, error: 'start time must be between 0 and 6 hours' };
  return { ok: true, url: url.toString(), start };
}

function run(command, args, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('sample command timed out')); }, timeoutMs);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`sample command exited ${code}: ${output.slice(-600)}`));
    });
  });
}

export class SampleCommandService extends EventEmitter {
  constructor({ outputDir, linuxOutputDir, throughWsl = process.platform === 'win32', wslDistro = 'Ubuntu-22.04', ytDlpPath = 'yt-dlp', ffmpegPath = 'ffmpeg', cooldownMs = 45_000, ownerOnly = true, isTrusted = () => false, logger = console }) {
    super();
    this.outputDir = outputDir;
    this.linuxOutputDir = linuxOutputDir;
    this.throughWsl = throughWsl;
    this.wslDistro = wslDistro;
    this.ytDlpPath = ytDlpPath;
    this.ffmpegPath = ffmpegPath;
    this.cooldownMs = cooldownMs;
    this.ownerOnly = ownerOnly;
    this.isTrusted = isTrusted;
    this.logger = logger;
    this.busy = false;
    this.lastAt = 0;
  }

  command(tool, args, timeoutMs) {
    if (!this.throughWsl) return run(tool, args, timeoutMs);
    return run(
      'wsl.exe',
      ['-d', this.wslDistro, '--', 'env', 'PATH=/usr/local/bin:/usr/bin:/bin', tool, ...args],
      timeoutMs,
    );
  }

  async pruneSamples(keep = 12) {
    const entries = await fs.readdir(this.outputDir, { withFileTypes: true });
    const samples = entries
      .filter((entry) => entry.isFile() && /^chat-sample-\d+\.wav$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
    await Promise.all(samples.slice(keep).map((name) => fs.unlink(path.join(this.outputDir, name)).catch(() => {})));
  }

  async submit(message, prefix) {
    const parsed = extractSampleRequest(message.text, prefix);
    if (!parsed) return false;
    const author = clean(message.name || 'viewer', 48);
    if (!parsed.ok) {
      this.emit('activity', { status: 'rejected', author, label: 'sample request', detail: parsed.error });
      return true;
    }
    if (this.ownerOnly && !this.isTrusted(message)) {
      this.emit('activity', { status: 'rejected', author, label: 'sample request', detail: 'owner/mod only' });
      return true;
    }
    const remaining = this.lastAt + this.cooldownMs - Date.now();
    if (this.busy || remaining > 0) {
      this.emit('activity', { status: 'rejected', author, label: 'sample request', detail: this.busy ? 'sampler busy' : `try again in ${Math.ceil(remaining / 1000)}s` });
      return true;
    }
    this.busy = true;
    this.lastAt = Date.now();
    const id = Date.now();
    const raw = `/tmp/vcv-chat-sample-${id}.wav`;
    const filename = `chat-sample-${id}.wav`;
    const finalLinux = `${this.linuxOutputDir.replace(/\/$/, '')}/${filename}`;
    this.emit('activity', { status: 'queued', author, label: '4-second sample', detail: `cutting at ${parsed.start.toFixed(1)}s` });
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      const end = parsed.start + 4;
      await this.command(this.ytDlpPath, [
        '--no-playlist', '--no-warnings', '--force-overwrites', '--ffmpeg-location', path.dirname(this.ffmpegPath),
        '--download-sections', `*${parsed.start}-${end}`,
        '--force-keyframes-at-cuts', '-f', 'bestaudio/best', '-x', '--audio-format', 'wav', '-o', raw, parsed.url,
      ], 120_000);
      await this.command(this.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-t', '4', '-ar', '48000', '-ac', '2',
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7,afade=t=in:st=0:d=0.03,afade=t=out:st=3.85:d=0.15', finalLinux,
      ], 45_000);
      const sample = { url: `/samples/${filename}`, author, start: parsed.start, duration: 4 };
      this.emit('sample', sample);
      this.emit('activity', { status: 'applied', author, label: '4-second sample', detail: 'normalized and fired' });
      await this.pruneSamples();
    } catch (error) {
      this.logger.error(`[sample] ${error.message}`);
      this.emit('activity', { status: 'rejected', author, label: 'sample request', detail: 'download or transcode failed' });
    } finally {
      void this.command('rm', ['-f', raw], 10_000).catch(() => {});
      this.busy = false;
    }
    return true;
  }
}

export const __test = { clean, parseTime, YOUTUBE_HOSTS };
