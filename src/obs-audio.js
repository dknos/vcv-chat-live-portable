import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export const INPUT_VOLUME_METERS_SUBSCRIPTION = 1 << 16;

export function obsAuthentication(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(`${password}${salt}`).digest('base64');
  return crypto.createHash('sha256').update(`${secret}${challenge}`).digest('base64');
}

export function normalizeMeterLevel(multiplier) {
  const value = Math.max(0, Number(multiplier) || 0);
  if (!value) return 0;
  const decibels = 20 * Math.log10(value);
  return Math.max(0, Math.min(1, (decibels + 52) / 44));
}

function defaultConfigPath() {
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json') : '';
}

export class ObsAudioMeter extends EventEmitter {
  constructor({ inputName = 'Performance Mic', cameraSource = 'DroidCam OBS', configPath = defaultConfigPath(), logger = console } = {}) {
    super();
    this.inputName = inputName;
    this.cameraSource = cameraSource;
    this.configPath = configPath;
    this.logger = logger;
    this.socket = null;
    this.reconnectTimer = null;
    this.frameTimer = null;
    this.frameRequestId = null;
    this.frameSequence = 0;
    this.stopping = false;
  }

  start() { this.stopping = false; this.#connect(); }

  close() {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.reconnectTimer = null;
    this.frameTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  #readConfig() {
    if (!this.configPath || !fs.existsSync(this.configPath)) return null;
    return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
  }

  #scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.#connect(); }, 2_000);
  }

  #connect() {
    let config;
    try {
      config = this.#readConfig();
      if (!config?.server_enabled) {
        this.emit('status', { ok: false, detail: 'OBS WebSocket is disabled' });
        this.#scheduleReconnect();
        return;
      }
      const socket = new WebSocket(`ws://127.0.0.1:${Number(config.server_port) || 4455}`);
      this.socket = socket;
      socket.addEventListener('message', (event) => this.#handleMessage(event.data, config));
      socket.addEventListener('close', () => {
        if (this.frameTimer) clearInterval(this.frameTimer);
        this.frameTimer = null;
        this.frameRequestId = null;
        this.emit('status', { ok: false, detail: 'waiting for OBS audio meters' });
        this.#scheduleReconnect();
      });
      socket.addEventListener('error', () => socket.close());
    } catch (error) {
      this.logger.warn(`[obs-audio] ${error.message}`);
      this.emit('status', { ok: false, detail: error.message });
      this.#scheduleReconnect();
    }
  }

  #requestCameraFrame() {
    if (!this.cameraSource || this.frameRequestId || this.socket?.readyState !== 1) return;
    this.frameRequestId = `camera-frame-${++this.frameSequence}`;
    this.socket.send(JSON.stringify({
      op: 6,
      d: {
        requestType: 'GetSourceScreenshot',
        requestId: this.frameRequestId,
        requestData: {
          sourceName: this.cameraSource,
          imageFormat: 'jpg',
          imageWidth: 256,
          imageHeight: 456,
          imageCompressionQuality: 38,
        },
      },
    }));
  }

  #handleMessage(raw, config) {
    const message = JSON.parse(String(raw));
    if (message.op === 0) {
      const hello = message.d || {};
      const identify = { rpcVersion: Math.min(1, Number(hello.rpcVersion) || 1), eventSubscriptions: INPUT_VOLUME_METERS_SUBSCRIPTION };
      if (hello.authentication) identify.authentication = obsAuthentication(config.server_password, hello.authentication.salt, hello.authentication.challenge);
      this.socket.send(JSON.stringify({ op: 1, d: identify }));
      return;
    }
    if (message.op === 2) {
      this.emit('status', { ok: true, detail: `reacting to ${this.inputName}` });
      if (!this.frameTimer) {
        this.#requestCameraFrame();
        this.frameTimer = setInterval(() => this.#requestCameraFrame(), 125);
      }
      return;
    }
    if (message.op === 7 && message.d?.requestId === this.frameRequestId) {
      this.frameRequestId = null;
      if (message.d.requestStatus?.result && message.d.responseData?.imageData) {
        this.emit('frame', { imageData: message.d.responseData.imageData, at: Date.now() });
      }
      return;
    }
    if (message.op !== 5 || message.d?.eventType !== 'InputVolumeMeters') return;
    const inputs = message.d.eventData?.inputs || [];
    const wanted = this.inputName.toLowerCase();
    const input = inputs.find((item) => String(item.inputName).toLowerCase() === wanted);
    if (!input) return;
    const channels = Array.isArray(input.inputLevelsMul) ? input.inputLevelsMul : [];
    const peak = Math.max(0, ...channels.flat().map((value) => Number(value) || 0));
    this.emit('level', { inputName: input.inputName, level: normalizeMeterLevel(peak), peak, at: Date.now() });
  }
}
