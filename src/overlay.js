import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function writeFile(res, req, file, contentType, cacheControl = 'public, max-age=31536000, immutable') {
  return fs.readFile(file).then((content) => {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(content);
  }).catch(() => writeJson(res, 404, { error: 'asset not found' }));
}

export class OverlayServer extends EventEmitter {
  constructor({ host, port, htmlPath, getSnapshot, logger = console }) {
    super();
    this.host = host;
    this.port = port;
    this.htmlPath = htmlPath;
    this.getSnapshot = getSnapshot;
    this.logger = logger;
    this.clients = new Set();
    this.server = null;
    this.heartbeat = null;
    this.htmlWatcher = null;
    this.reloadTimer = null;
    this.html = null;
    this.status = {
      chat: { ok: false, active: false, detail: 'starting' },
      osc: { ok: true, detail: 'ready' },
    };
  }

  publish(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  setStatus(name, value) {
    this.status[name] = { ...this.status[name], ...value };
    this.publish('status', this.status);
  }

  async start() {
    this.html = await fs.readFile(this.htmlPath);
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'POST' && url.pathname === '/tracker-status') {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 2048) req.destroy();
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(raw);
            const mode = payload.mode === 'GPU' ? 'GPU' : 'CPU';
            const renderer = String(payload.renderer || '').slice(0, 240);
            const error = String(payload.error || '').slice(0, 240);
            const features = String(payload.features || '').slice(0, 80);
            this.setStatus('tracking', {
              ok: mode === 'GPU',
              mode,
              renderer,
              features,
              detail: mode === 'GPU' ? `GPU ${features || 'landmarks'} on ${renderer}` : `CPU fallback${error ? `: ${error}` : ''}`,
            });
            writeJson(res, 200, { ok: true });
          } catch {
            writeJson(res, 400, { error: 'invalid tracker status' });
          }
        });
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }

      if (url.pathname === '/' || url.pathname === '/overlay') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': this.html.length,
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; worker-src 'self' blob:",
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        });
        if (req.method === 'HEAD') res.end();
        else res.end(this.html);
        return;
      }

      if (['/models/hand_landmarker.task', '/models/pose_landmarker_lite.task', '/models/face_landmarker.task'].includes(url.pathname)) {
        const file = path.join(path.dirname(this.htmlPath), 'models', path.basename(url.pathname));
        void writeFile(res, req, file, 'application/octet-stream');
        return;
      }

      if (url.pathname === '/gpu-hand-tracker.mjs') {
        const file = path.join(path.dirname(this.htmlPath), 'gpu-hand-tracker.mjs');
        void writeFile(res, req, file, 'text/javascript; charset=utf-8', 'no-store');
        return;
      }

      if (url.pathname.startsWith('/vendor/mediapipe/')) {
        const relative = url.pathname.slice('/vendor/mediapipe/'.length);
        const allowed = /^(?:vision_bundle\.mjs|wasm\/vision_wasm_(?:internal|module_internal|nosimd_internal)\.(?:js|wasm))$/u;
        if (!allowed.test(relative)) {
          writeJson(res, 404, { error: 'asset not found' });
          return;
        }
        const file = path.join(
          path.dirname(this.htmlPath),
          '..',
          'node_modules',
          '@mediapipe',
          'tasks-vision',
          ...relative.split('/'),
        );
        const contentType = relative.endsWith('.mjs')
          ? 'text/javascript; charset=utf-8'
          : relative.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : 'application/wasm';
        void writeFile(res, req, file, contentType);
        return;
      }

      if (url.pathname === '/state') {
        writeJson(res, 200, { ...this.getSnapshot(), status: this.status });
        return;
      }

      if (url.pathname.startsWith('/generated/')) {
        const name = path.basename(url.pathname);
        const file = path.join(path.dirname(this.htmlPath), 'generated', name);
        const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        fs.readFile(file).then((image) => {
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': image.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          if (req.method === 'HEAD') res.end(); else res.end(image);
        }).catch(() => writeJson(res, 404, { error: 'image not found' }));
        return;
      }

      if (url.pathname.startsWith('/samples/')) {
        const name = path.basename(url.pathname);
        if (!/^(?:chat-sample-\d+|chat-voice-\d+-\d+)\.wav$/.test(name)) {
          writeJson(res, 404, { error: 'sample not found' });
          return;
        }
        const file = path.join(path.dirname(this.htmlPath), 'samples', name);
        fs.readFile(file).then((audio) => {
          res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          if (req.method === 'HEAD') res.end(); else res.end(audio);
        }).catch(() => writeJson(res, 404, { error: 'sample not found' }));
        return;
      }

      if (url.pathname === '/healthz') {
        writeJson(res, 200, {
          ok: true,
          clients: this.clients.size,
          status: this.status,
        });
        return;
      }

      if (url.pathname === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff',
        });
        res.write(': connected\n\n');
        res.write(`event: snapshot\ndata: ${JSON.stringify(this.getSnapshot())}\n\n`);
        res.write(`event: status\ndata: ${JSON.stringify(this.status)}\n\n`);
        this.clients.add(res);
        req.on('close', () => this.clients.delete(res));
        return;
      }

      writeJson(res, 404, { error: 'not found' });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) client.write(': heartbeat\n\n');
    }, 15_000);
    this.htmlModifiedAt = (await fs.stat(this.htmlPath)).mtimeMs;
    this.htmlWatcher = setInterval(async () => {
      try {
        const modifiedAt = (await fs.stat(this.htmlPath)).mtimeMs;
        if (modifiedAt <= this.htmlModifiedAt) return;
        this.html = await fs.readFile(this.htmlPath);
        this.htmlModifiedAt = modifiedAt;
        this.publish('reload', { reason: 'overlay updated' });
        this.logger.log('[overlay] live reload sent');
      } catch (error) {
        this.logger.warn(`[overlay] live reload skipped: ${error.message}`);
      }
    }, 1000);
    this.logger.log(`[overlay] http://${this.host}:${this.port}/overlay`);
  }

  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    if (this.htmlWatcher) clearInterval(this.htmlWatcher);
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
  }
}
