#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SOURCE = 'DroidCam Phone';
const DEFAULT_SCENE = 'Phone Live';

function sha256Base64(value) {
  return crypto.createHash('sha256').update(value).digest('base64');
}

export function computeObsAuthentication(password, salt, challenge) {
  if (![password, salt, challenge].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('OBS WebSocket authentication data is incomplete');
  }
  const secret = sha256Base64(`${password}${salt}`);
  return sha256Base64(`${secret}${challenge}`);
}

export function parseScreenshotDataUrl(value) {
  const match = String(value || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u);
  if (!match) throw new Error('OBS returned an invalid phone-source screenshot');
  return Buffer.from(match[1], 'base64');
}

export function validateFramePair(first, second, minimumBytes = 2048) {
  if (!Buffer.isBuffer(first) || !Buffer.isBuffer(second)) {
    throw new Error('phone frame validation requires two image buffers');
  }
  if (first.length < minimumBytes || second.length < minimumBytes) {
    throw new Error('DroidCam frames are blank or too small');
  }
  const firstHash = crypto.createHash('sha256').update(first).digest('hex');
  const secondHash = crypto.createHash('sha256').update(second).digest('hex');
  if (firstHash === secondHash) {
    throw new Error('DroidCam did not deliver a fresh frame');
  }
  return { bytes: second.length, fresh: true };
}

export function parseArgs(args) {
  const values = new Map([
    ['--config', 'configFile'],
    ['--source', 'sourceName'],
    ['--scene', 'sceneName'],
    ['--output', 'outputFile'],
  ]);
  const parsed = { sourceName: DEFAULT_SOURCE, sceneName: DEFAULT_SCENE };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const property = values.get(flag);
    if (!property) throw new Error(`unknown argument: ${flag}`);
    if (Object.hasOwn(parsed, `_${property}`)) throw new Error(`duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    parsed[property] = value;
    parsed[`_${property}`] = true;
    index += 1;
  }
  for (const key of Object.keys(parsed)) {
    if (key.startsWith('_')) delete parsed[key];
  }
  if (!parsed.configFile) throw new Error('--config is required');
  return parsed;
}

export function readObsWebSocketConfig(configFile) {
  if (path.basename(configFile).toLowerCase() !== 'config.json') {
    throw new Error('OBS WebSocket config path must name config.json');
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    throw new Error('OBS WebSocket configuration is missing or invalid');
  }
  if (config.server_enabled !== true) throw new Error('OBS WebSocket server is disabled');
  const port = Number(config.server_port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('OBS WebSocket port is invalid');
  }
  if (config.auth_required !== true || typeof config.server_password !== 'string' || !config.server_password) {
    throw new Error('OBS WebSocket authentication must be enabled');
  }
  return { password: config.server_password, port };
}

export function connectObs({ password, port, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const pending = new Map();
    let identified = false;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('OBS WebSocket verification timed out'));
    }, timeoutMs);

    const fail = (error) => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    socket.addEventListener('error', () => fail(new Error('OBS WebSocket connection failed')));
    socket.addEventListener('close', () => {
      if (!identified) {
        fail(new Error('OBS WebSocket closed before identification'));
        return;
      }
      for (const handler of pending.values()) {
        clearTimeout(handler.timer);
        handler.reject(new Error('OBS WebSocket closed before a request completed'));
      }
      pending.clear();
    });
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        fail(new Error('OBS WebSocket returned invalid JSON'));
        return;
      }

      if (message.op === 0) {
        const authentication = message.d?.authentication;
        if (!authentication) {
          fail(new Error('OBS WebSocket did not require the reviewed authentication configuration'));
          return;
        }
        let response;
        try {
          response = computeObsAuthentication(password, authentication.salt, authentication.challenge);
        } catch (error) {
          fail(error);
          return;
        }
        socket.send(JSON.stringify({
          op: 1,
          d: { rpcVersion: 1, authentication: response, eventSubscriptions: 0 },
        }));
        return;
      }

      if (message.op === 2) {
        identified = true;
        clearTimeout(timer);
        let requestCounter = 0;
        resolve({
          close: () => socket.close(),
          request(requestType, requestData = {}) {
            return new Promise((requestResolve, requestReject) => {
              const requestId = `phone-check-${process.pid}-${requestCounter += 1}`;
              const requestTimer = setTimeout(() => {
                pending.delete(requestId);
                requestReject(new Error(`OBS request timed out: ${requestType}`));
              }, 5000);
              pending.set(requestId, {
                resolve: requestResolve,
                reject: requestReject,
                timer: requestTimer,
              });
              socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
            });
          },
        });
        return;
      }

      if (message.op === 7) {
        const requestId = message.d?.requestId;
        const handler = pending.get(requestId);
        if (!handler) return;
        pending.delete(requestId);
        clearTimeout(handler.timer);
        if (message.d?.requestStatus?.result !== true) {
          handler.reject(new Error(`OBS request failed: ${message.d?.requestStatus?.comment || 'unknown error'}`));
        } else {
          handler.resolve(message.d?.responseData || {});
        }
      }
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function verifyObsPhoneVideo(options) {
  const server = readObsWebSocketConfig(options.configFile);
  const obs = await connectObs(server);
  try {
    const scene = await obs.request('GetCurrentProgramScene');
    if (scene.currentProgramSceneName !== options.sceneName) {
      throw new Error(`OBS current scene is ${scene.currentProgramSceneName || 'unknown'}, not ${options.sceneName}`);
    }
    const screenshotRequest = {
      sourceName: options.sourceName,
      imageFormat: 'png',
      imageWidth: 480,
      imageCompressionQuality: 70,
    };
    const first = parseScreenshotDataUrl((await obs.request('GetSourceScreenshot', screenshotRequest)).imageData);
    await delay(900);
    const second = parseScreenshotDataUrl((await obs.request('GetSourceScreenshot', screenshotRequest)).imageData);
    const frame = validateFramePair(first, second);
    if (options.outputFile) {
      fs.writeFileSync(path.resolve(options.outputFile), second);
    }
    return {
      scene: options.sceneName,
      source: options.sourceName,
      fresh: frame.fresh,
      bytes: frame.bytes,
      outputFile: options.outputFile ? path.resolve(options.outputFile) : undefined,
    };
  } finally {
    obs.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const result = await verifyObsPhoneVideo(parseArgs(args));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`phone video verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
