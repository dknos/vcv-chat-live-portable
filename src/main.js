#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SessionChatSource, StdinChatSource } from './chat-source.js';
import { loadConfig } from './config.js';
import { loadEnvFile } from './env.js';
import { ImageCommandService } from './image-command.js';
import { ModelClient, ModelControlService } from './model-control.js';
import { MusicController } from './music.js';
import { OscClient } from './osc.js';
import { ObsAudioMeter } from './obs-audio.js';
import { OverlayServer } from './overlay.js';
import { SampleCommandService } from './sample-command.js';
import { TtsCommandService } from './tts-command.js';
import { GenerativeSequencer } from './sequencer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
await loadEnvFile(path.join(root, '.env'));
const config = loadConfig();

const osc = new OscClient({ ...config.osc, logger: console });
const controller = new MusicController({ config, osc });
const sequencer = new GenerativeSequencer({ controller, osc, logger: console });
const overlay = new OverlayServer({
  ...config.overlay,
  htmlPath: path.join(root, 'public', 'overlay.html'),
  getSnapshot: () => controller.snapshot(),
  logger: console,
});
const obsAudio = new ObsAudioMeter({
  inputName: process.env.OBS_AUDIO_REACTIVE_INPUT || 'Performance Mic',
  cameraSource: process.env.OBS_CAMERA_REACTIVE_SOURCE || 'DroidCam OBS',
  logger: console,
});
const images = new ImageCommandService({
  outputDir: path.join(root, 'public', 'generated'),
  grokPath: config.images.grokPath,
  grokThroughWsl: config.images.grokThroughWsl,
  grokLinuxPath: config.images.grokLinuxPath,
  grokWslDistro: config.images.grokWslDistro,
  grokSessionRoot: config.images.grokSessionRoot,
  cooldownMs: config.images.cooldownMs,
  logger: console,
});
const samples = new SampleCommandService({
  outputDir: path.join(root, 'public', 'samples'),
  linuxOutputDir: config.samples.linuxOutputDir,
  throughWsl: config.samples.throughWsl,
  wslDistro: config.samples.wslDistro,
  ytDlpPath: config.samples.ytDlpPath,
  ffmpegPath: config.samples.ffmpegPath,
  cooldownMs: config.samples.cooldownMs,
  ownerOnly: config.samples.ownerOnly,
  isTrusted: (message) => controller.isTrusted(message),
  logger: console,
});
const tts = new TtsCommandService({
  outputDir: path.join(root, 'public', 'samples'),
  linuxOutputDir: config.tts.linuxOutputDir,
  throughWsl: config.tts.throughWsl,
  wslDistro: config.tts.wslDistro,
  ffmpegPath: config.tts.ffmpegPath,
  apiKey: config.tts.apiKey,
  modelId: config.tts.modelId,
  cooldownMs: config.tts.cooldownMs,
  ownerOnly: config.tts.ownerOnly,
  isTrusted: (message) => controller.isTrusted(message),
  logger: console,
});
const modelClient = config.model.enabled
  ? new ModelClient({
      provider: config.model.provider,
      baseUrl: config.model.baseUrl,
      apiKey: config.model.apiKey,
      model: config.model.name,
      timeoutMs: config.model.timeoutMs,
      maxCommands: config.model.maxCommands,
    })
  : null;
const models = new ModelControlService({
  enabled: config.model.enabled,
  ownerOnly: config.model.ownerOnly,
  prefix: config.commands.prefix,
  trigger: config.model.trigger,
  cooldownMs: config.model.cooldownMs,
  maxCommands: config.model.maxCommands,
  client: modelClient,
  isTrusted: (message) => controller.isTrusted(message),
  getSnapshot: () => controller.snapshot(),
  applyCommand: (message) => controller.submit(message),
  logger: console,
});

const rareEventTiers = [
  { odds: 10_000, name: 'ZOMG', detail: '1 IN 10,000 // THE SCREEN HAS LOST IT', style: 'zomg' },
  { odds: 1_000, name: 'SYSTEM OVERRIDE', detail: '1 IN 1,000 // SIGNAL BREACH', style: 'override' },
  { odds: 500, name: 'BLACK STAR', detail: '1 IN 500 // GRAVITY SHIFT', style: 'blackstar' },
  { odds: 100, name: 'RACK POSSESSED', detail: '1 IN 100 // PATCH ANOMALY', style: 'possessed' },
  { odds: 50, name: 'COLOR RIOT', detail: '1 IN 50 // VISUAL TAKEOVER', style: 'riot' },
  { odds: 20, name: 'SIGNAL FLARE', detail: '1 IN 20 // LUCKY COMMAND', style: 'flare' },
];

function rollRareEvent() {
  return rareEventTiers.find((tier) => Math.floor(Math.random() * tier.odds) === 0) || null;
}

controller.on('snapshot', (snapshot) => overlay.publish('snapshot', snapshot));
sequencer.on('step', ({ step, bar, events }) => {
  overlay.publish('music-step', { step, bar, events, at: Date.now() });
});
controller.on('activity', (item) => {
  const suffix = item.detail ? ` (${item.detail})` : '';
  console.log(`[command:${item.status}] ${item.author}: ${item.label}${suffix}`);
  if (item.status === 'applied') overlay.publish('command-spotlight', { item, rare: rollRareEvent() });
});
controller.on('scale-cycle', ({ scale, bars }) => {
  const item = { author: 'SYSTEM', label: `SCALE SHIFT // ${scale.toUpperCase()}`, detail: `next color in ${bars} bars` };
  overlay.publish('command-spotlight', { item, rare: null });
  overlay.publish('activity', { status: 'applied', author: 'SYSTEM', label: `scale ${scale}`, detail: `jazz cycle / ${bars} bars` });
  console.log(`[scale-cycle] ${scale} / ${bars} bars`);
});
images.on('activity', (item) => {
  overlay.publish('activity', item);
  console.log(`[image:${item.status}] ${item.author}: ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
});
images.on('image', (image) => overlay.publish('image', image));
images.on('accelerate', () => overlay.publish('image-control', { action: 'accelerate' }));
samples.on('activity', (item) => {
  overlay.publish('activity', item);
  console.log(`[sample:${item.status}] ${item.author}: ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
});
samples.on('sample', (sample) => overlay.publish('sample', sample));
tts.on('activity', (item) => {
  overlay.publish('activity', item);
  console.log(`[voice:${item.status}] ${item.author}: ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
});
tts.on('voice', (voice) => overlay.publish('voice', voice));
models.on('activity', (item) => {
  overlay.publish('activity', item);
  console.log(`[model:${item.status}] ${item.author}: ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
});
models.on('status', (status) => overlay.setStatus('model-control', status));
obsAudio.on('level', (level) => overlay.publish('audio-level', level));
obsAudio.on('frame', (frame) => overlay.publish('camera-frame', frame));
obsAudio.on('status', (status) => overlay.setStatus('audio-reactive', status));
osc.on('error', (error) => {
  console.error(`[osc] ${error.message}`);
  overlay.setStatus('osc', { ok: false, detail: error.message });
});
osc.on('send', ({ address }) => {
  overlay.setStatus('osc', {
    ok: true,
    detail: config.osc.dryRun ? 'dry run' : `UDP ${config.osc.host}:${config.osc.port} (${address})`,
  });
});

let source;
async function handleMessage(message) {
  if (config.images.enabled && await images.submit(message, config.commands.prefix)) return;
  if (config.samples.enabled && await samples.submit(message, config.commands.prefix)) return;
  if (config.tts.enabled && await tts.submit(message, config.commands.prefix)) return;
  if (await models.submit(message)) return;
  await controller.submit(message);
}
if (config.chat.source === 'stdin') {
  source = new StdinChatSource({ onMessage: handleMessage, logger: console });
} else {
  source = new SessionChatSource({
    file: config.chat.sessionFile,
    pollMs: config.chat.pollMs,
    startupGraceMs: config.chat.startupGraceMs,
    staleMs: config.chat.staleMs,
    onMessage: handleMessage,
    logger: console,
  });
}
source.on('message', (message) => overlay.publish('chat-message', message));
source.on('status', (status) => overlay.setStatus('chat', status));

let scheduler;
let stateSync;
let stopping = false;
async function shutdown(signal = 'shutdown') {
  if (stopping) return;
  stopping = true;
  console.log(`[app] ${signal}; stopping`);
  if (scheduler) clearInterval(scheduler);
  if (stateSync) clearInterval(stateSync);
  sequencer.stop();
  obsAudio.close();
  await source.close();
  await overlay.close();
  osc.close();
}

process.once('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));

try {
  await overlay.start();
  obsAudio.start();
  overlay.setStatus('osc', {
    ok: true,
    detail: config.osc.dryRun ? 'dry run' : `UDP ${config.osc.host}:${config.osc.port}`,
  });
  overlay.setStatus('model-control', {
    ok: true,
    active: false,
    detail: config.model.enabled
      ? `${config.model.provider} / ${config.model.name || 'webhook'}`
      : 'disabled',
  });
  await controller.sync();
  sequencer.start();
  await source.start();
  scheduler = setInterval(() => {
    void controller.tick().catch((error) => console.error(`[scheduler] ${error.message}`));
  }, config.scheduler.tickMs);
  // Rack can be restarted independently to install/update libraries. Reassert
  // the bounded persistent state so the fail-closed master gate recovers
  // automatically instead of leaving a newly loaded patch silent.
  stateSync = setInterval(() => {
    void controller.sync().catch((error) => console.error(`[state-sync] ${error.message}`));
  }, 5_000);
  console.log(
    `[app] ready source=${config.chat.source} prefix=${config.commands.prefix} ` +
      `quantize=${config.scheduler.quantizeBars ? 'bar' : 'off'}`,
  );
} catch (error) {
  console.error(`[app] fatal: ${error.stack || error.message}`);
  await shutdown('fatal');
  process.exitCode = 1;
}
