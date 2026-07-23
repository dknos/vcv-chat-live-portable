import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function numberInRange(env, key, fallback, min, max) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number from ${min} to ${max}`);
  }
  return value;
}

function booleanValue(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`${key} must be 1/0, true/false, yes/no, or on/off`);
}

function csv(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function normalizeNamespace(value) {
  const trimmed = String(value || '/chat').trim();
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, '') || '/chat';
}

function enumValue(env, key, fallback, allowed) {
  const value = String(env[key] || fallback).trim().toLowerCase();
  if (!allowed.includes(value)) throw new Error(`${key} must be one of: ${allowed.join(', ')}`);
  return value;
}

function optionalHttpUrl(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${key} must use HTTP or HTTPS`);
  return url.toString().replace(/\/+$/, '');
}

export function loadConfig(env = process.env) {
  const source = (env.CHAT_SOURCE || 'session').toLowerCase();
  if (!['session', 'stdin'].includes(source)) {
    throw new Error('CHAT_SOURCE must be session or stdin');
  }

  return {
    chat: {
      source,
      sessionFile:
        env.CHAT_SESSION_FILE ||
        path.join(PROJECT_ROOT, 'state', 'live-session.json'),
      pollMs: numberInRange(env, 'CHAT_POLL_MS', 1000, 250, 10_000),
      startupGraceMs: numberInRange(env, 'CHAT_STARTUP_GRACE_MS', 0, 0, 60_000),
      staleMs: numberInRange(env, 'CHAT_STALE_MS', 60_000, 10_000, 600_000),
    },
    commands: {
      prefix: (env.COMMAND_PREFIX || '!rack').trim().toLowerCase(),
      directAliases: booleanValue(env, 'DIRECT_COMMAND_ALIASES', true),
      perUserCooldownMs: numberInRange(env, 'PER_USER_COOLDOWN_MS', 3000, 0, 300_000),
      globalCooldownMs: numberInRange(env, 'GLOBAL_COOLDOWN_MS', 350, 0, 30_000),
      maxActionsPerBar: numberInRange(env, 'MAX_ACTIONS_PER_BAR', 8, 1, 64),
      trustedChannelIds: csv(env.TRUSTED_CHANNEL_IDS),
      trustedDisplayNames: new Set(
        [...csv(env.TRUSTED_DISPLAY_NAMES)].map((value) => value.toLowerCase()),
      ),
    },
    scheduler: {
      quantizeBars: booleanValue(env, 'QUANTIZE_BARS', true),
      beatsPerBar: numberInRange(env, 'BEATS_PER_BAR', 4, 1, 16),
      tickMs: numberInRange(env, 'SCHEDULER_TICK_MS', 25, 10, 500),
    },
    osc: {
      host: (env.OSC_HOST || '127.0.0.1').trim(),
      port: numberInRange(env, 'OSC_PORT', 7001, 1, 65_535),
      namespace: normalizeNamespace(env.OSC_NAMESPACE),
      dryRun: booleanValue(env, 'DRY_RUN', false),
    },
    overlay: {
      host: (env.OVERLAY_HOST || '127.0.0.1').trim(),
      port: numberInRange(env, 'OVERLAY_PORT', 9392, 1, 65_535),
    },
    images: {
      enabled: booleanValue(env, 'IMAGE_COMMANDS_ENABLED', true),
      cooldownMs: numberInRange(env, 'IMAGE_COMMAND_COOLDOWN_MS', 30_000, 5_000, 300_000),
      grokThroughWsl: booleanValue(env, 'GROK_IMAGE_THROUGH_WSL', process.platform === 'win32'),
      grokPath: (env.GROK_IMAGE_COMMAND || (process.platform === 'win32' ? 'wsl.exe' : path.join(os.homedir(), '.local', 'bin', 'grok-gen'))).trim(),
      grokLinuxPath: (env.GROK_IMAGE_LINUX_COMMAND || 'grok-gen').trim(),
      grokWslDistro: (env.GROK_IMAGE_WSL_DISTRO || 'Ubuntu-22.04').trim(),
      grokSessionRoot: (env.GROK_IMAGE_SESSION_ROOT || (process.platform === 'win32'
        ? ''
        : path.join(os.homedir(), '.grok', 'sessions'))).trim(),
    },
    samples: {
      enabled: booleanValue(env, 'SAMPLE_COMMANDS_ENABLED', true),
      ownerOnly: booleanValue(env, 'SAMPLE_OWNER_ONLY', true),
      cooldownMs: numberInRange(env, 'SAMPLE_COMMAND_COOLDOWN_MS', 45_000, 5_000, 600_000),
      throughWsl: booleanValue(env, 'SAMPLE_TOOLS_THROUGH_WSL', process.platform === 'win32'),
      wslDistro: (env.SAMPLE_WSL_DISTRO || 'Ubuntu-22.04').trim(),
      ytDlpPath: (env.SAMPLE_YTDLP_COMMAND || 'yt-dlp').trim(),
      ffmpegPath: (env.SAMPLE_FFMPEG_COMMAND || '/usr/bin/ffmpeg').trim(),
      linuxOutputDir: (env.SAMPLE_LINUX_OUTPUT_DIR || path.join(PROJECT_ROOT, 'public', 'samples')).trim(),
    },
    tts: {
      enabled: booleanValue(env, 'TTS_COMMANDS_ENABLED', Boolean(env.ELEVENLABS_API_KEY)),
      ownerOnly: booleanValue(env, 'TTS_OWNER_ONLY', true),
      cooldownMs: numberInRange(env, 'TTS_COMMAND_COOLDOWN_MS', 30_000, 5_000, 600_000),
      apiKey: (env.ELEVENLABS_API_KEY || '').trim(),
      modelId: (env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2').trim(),
      throughWsl: booleanValue(env, 'TTS_TOOLS_THROUGH_WSL', process.platform === 'win32'),
      wslDistro: (env.TTS_WSL_DISTRO || 'Ubuntu-22.04').trim(),
      ffmpegPath: (env.TTS_FFMPEG_COMMAND || '/usr/bin/ffmpeg').trim(),
      linuxOutputDir: (env.TTS_LINUX_OUTPUT_DIR || path.join(PROJECT_ROOT, 'public', 'samples')).trim(),
    },
    model: {
      enabled: booleanValue(env, 'MODEL_CONTROL_ENABLED', false),
      ownerOnly: booleanValue(env, 'MODEL_OWNER_ONLY', true),
      provider: enumValue(
        env,
        'MODEL_PROVIDER',
        'openai-compatible',
        ['openai-compatible', 'anthropic', 'gemini', 'webhook'],
      ),
      baseUrl: optionalHttpUrl(env, 'MODEL_BASE_URL'),
      apiKey: String(env.MODEL_API_KEY || '').trim(),
      name: String(env.MODEL_NAME || '').trim(),
      trigger: String(env.MODEL_TRIGGER || '!ai').trim().toLowerCase(),
      cooldownMs: numberInRange(env, 'MODEL_COOLDOWN_MS', 15_000, 5_000, 300_000),
      timeoutMs: numberInRange(env, 'MODEL_TIMEOUT_MS', 30_000, 1_000, 120_000),
      maxCommands: numberInRange(env, 'MODEL_MAX_COMMANDS', 4, 1, 8),
    },
  };
}

export const __test = {
  numberInRange,
  booleanValue,
  csv,
  normalizeNamespace,
  enumValue,
  optionalHttpUrl,
};
