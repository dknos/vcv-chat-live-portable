#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'AGENTS.md',
  '.env.example',
  'public/gpu-hand-tracker.mjs',
  'public/models/hand_landmarker.task',
  'public/models/pose_landmarker_lite.task',
  'public/models/face_landmarker.task',
  'public/overlay.html',
  'patches/ChatRack-Live.vcv',
  'patches/Doom-Jazz-Machine.vcv',
  'scripts/build-doom-jazz-patch.mjs',
  'scripts/load-rack-profile.ps1',
  'scripts/prepare-obs-phone.ps1',
  'scripts/manage-chat-reader.sh',
  'scripts/youtube-chat-reader.py',
  'scripts/set-obs-rack-monitoring.ps1',
  'scripts/verify-obs-phone-video.mjs',
  'docs/MODEL_CONTROL.md',
  'src/main.js',
  'src/model-control.js',
  'src/music.js',
  'src/pattern-grammar.js',
  'src/sample-command.js',
];

let failed = false;
function report(ok, label, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failed = true;
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
report(nodeMajor >= 22, 'Node.js', process.version);
for (const relative of requiredFiles) {
  report(fs.existsSync(path.join(root, relative)), relative);
}

function commandVersion(label, candidates, args) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) {
      const version = `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0];
      console.log(`OK   ${label} - ${candidate} ${version}`);
      return;
    }
  }
  console.log(`WARN ${label} not found; required only for !sample runtime`);
}

commandVersion('yt-dlp', ['yt-dlp', path.join(process.env.HOME || '', '.local/bin/yt-dlp')], ['--version']);
commandVersion('ffmpeg', ['ffmpeg', path.join(process.env.HOME || '', '.local/bin/ffmpeg')], ['-version']);

const envPath = path.join(root, '.env');
console.log(`${fs.existsSync(envPath) ? 'OK  ' : 'WARN'} .env${fs.existsSync(envPath) ? '' : ' not created; copy .env.example before live use'}`);

if (failed) process.exitCode = 1;
else console.log('Doctor completed: repository prerequisites are structurally ready.');
