import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function cleanPrompt(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function extractImagePrompt(text, prefix = '!rack') {
  const cleaned = String(text || '').trim();
  const scoped = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+image\\s+(.+)$`, 'i');
  const match = cleaned.match(/^!image\s+(.+)$/i) || cleaned.match(scoped);
  if (!match) return null;
  const prompt = cleanPrompt(match[1]);
  if (prompt.length < 4) return { ok: false, error: 'image prompt needs at least 4 characters' };
  if (/https?:\/\/|www\./i.test(prompt)) return { ok: false, error: 'image prompts cannot contain links' };
  return { ok: true, prompt };
}

function isAccelerateCommand(text, prefix) {
  const cleaned = String(text || '').trim().toLowerCase();
  return cleaned === '!accelerate' || cleaned === `${prefix} accelerate`;
}

function isRestoreCommand(text, prefix) {
  const cleaned = String(text || '').trim().toLowerCase();
  return cleaned === '!bringback' || cleaned === '!images' || cleaned === `${prefix} bringback` || cleaned === `${prefix} images`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`Grok image generation exited ${code}: ${output.slice(-500)}`)));
  });
}

function imagePaths(output) {
  return [...String(output).matchAll(/(?:^|\s)(\/[^\s]+\.(?:png|jpe?g|webp))(?:\s|$)/gim)]
    .map((match) => match[1])
    .filter(Boolean);
}

async function newestGrokImage(root, afterMs) {
  const pending = [root];
  let newest = null;
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) {
        const stat = await fs.stat(file);
        if (stat.mtimeMs >= afterMs && (!newest || stat.mtimeMs > newest.mtimeMs)) newest = { file, mtimeMs: stat.mtimeMs };
      }
    }
  }
  return newest?.file || null;
}

export class ImageCommandService extends EventEmitter {
  constructor({ outputDir, publicPath = '/generated', grokPath, grokThroughWsl = false, grokLinuxPath, grokWslDistro, grokSessionRoot, cooldownMs = 30_000, logger = console }) {
    super();
    this.outputDir = outputDir;
    this.publicPath = publicPath;
    this.grokPath = grokPath;
    this.grokThroughWsl = grokThroughWsl;
    this.grokLinuxPath = grokLinuxPath;
    this.grokWslDistro = grokWslDistro;
    this.grokSessionRoot = grokSessionRoot;
    this.cooldownMs = cooldownMs;
    this.logger = logger;
    this.busy = false;
    this.lastAt = 0;
  }

  async submit(message, prefix) {
    if (isAccelerateCommand(message.text, prefix)) {
      this.emit('accelerate');
      this.emit('activity', { status: 'applied', author: message.name, label: 'image swarm accelerate', detail: 'speed burst' });
      return true;
    }
    if (isRestoreCommand(message.text, prefix)) {
      const recent = await this.recentImages(4);
      if (!recent.length) {
        this.emit('activity', { status: 'rejected', author: message.name, label: 'restore images', detail: 'no saved images yet' });
      } else {
        for (const file of recent.reverse()) {
          this.emit('image', { url: `${this.publicPath}/${file}`, prompt: 'brought back from the image vault', author: message.name });
        }
        this.emit('activity', { status: 'applied', author: message.name, label: 'restore images', detail: `${recent.length} images returned` });
      }
      return true;
    }
    const parsed = extractImagePrompt(message.text, prefix);
    if (!parsed) return false;
    if (!parsed.ok) {
      this.emit('activity', { status: 'rejected', author: message.name, label: 'image request', detail: parsed.error });
      return true;
    }
    const remaining = this.lastAt + this.cooldownMs - Date.now();
    if (this.busy || remaining > 0) {
      this.emit('activity', { status: 'rejected', author: message.name, label: 'image request', detail: this.busy ? 'image queue busy' : `try again in ${Math.ceil(remaining / 1000)}s` });
      return true;
    }
    this.busy = true;
    this.lastAt = Date.now();
    this.emit('activity', { status: 'queued', author: message.name, label: `image: ${parsed.prompt}`, detail: 'generating with Grok' });
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      const prompt = `Square live-stream visual: ${parsed.prompt}. Clear central subject, bold silhouette, high contrast, colorful, no text, no watermark, no logo.`;
      const startedAt = Date.now() - 2_000;
      const imageArgs = ['image', prompt, '--count', '1', '--aspect', '1:1', '--mode', 'yolo'];
      const output = await run(this.grokPath, this.grokThroughWsl
        ? ['-d', this.grokWslDistro, '--', 'env', 'PATH=/usr/local/bin:/usr/bin:/bin', this.grokLinuxPath, ...imageArgs]
        : imageArgs);
      const reported = imagePaths(output).at(-1);
      let source = reported && path.isAbsolute(reported)
        ? reported
        : await newestGrokImage(this.grokSessionRoot, startedAt);
      if (source && this.grokThroughWsl && source.startsWith('/')) {
        source = (await run('wsl.exe', ['-d', this.grokWslDistro, '--', 'wslpath', '-w', source])).trim();
      }
      if (!source) throw new Error('Grok returned no image path');
      const extension = path.extname(source).toLowerCase();
      const name = `chat-image-${Date.now()}${extension}`;
      await fs.copyFile(source, path.join(this.outputDir, name));
      const image = { url: `${this.publicPath}/${name}`, prompt: parsed.prompt, author: message.name };
      this.emit('image', image);
      this.emit('activity', { status: 'applied', author: message.name, label: `image: ${parsed.prompt}`, detail: 'bouncing on screen' });
    } catch (error) {
      this.logger.error(`[image] ${error.message}`);
      this.emit('activity', { status: 'rejected', author: message.name, label: `image: ${parsed.prompt}`, detail: 'generation failed' });
    } finally {
      this.busy = false;
    }
    return true;
  }

  async recentImages(limit) {
    try {
      const entries = await fs.readdir(this.outputDir, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile() && /^chat-image-.*\.(?:png|jpe?g|webp)$/i.test(entry.name));
      const dated = await Promise.all(files.map(async (entry) => ({ name: entry.name, stat: await fs.stat(path.join(this.outputDir, entry.name)) })));
      return dated.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, limit).map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}

export const __test = { cleanPrompt, extractImagePrompt, imagePaths, isAccelerateCommand, isRestoreCommand };
