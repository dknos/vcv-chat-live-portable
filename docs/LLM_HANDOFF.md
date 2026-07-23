# Model-independent handoff

This repository does not require a particular coding model. GPT, Claude, Grok,
Gemini, Qwen, or a local agent can operate it if it can edit files and run
shell/PowerShell commands on the host.

Read `AGENTS.md` first. Never paste secrets into prompts, source files, commits,
issues, logs, or screenshots.

## First-run sequence

```bash
npm ci
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-chat.txt
cp .env.example .env
npm run doctor
npm run check
npm test
npm run simulate
```

Discover local paths, devices, WSL distribution names, OBS scenes, and VCV
modules. Do not assume an operator username, channel, video ID, audio interface,
camera, model provider, or filesystem layout.

## Runtime shape

```text
YouTube session JSON
  -> Node bridge and command safety layer
  -> pattern grammar and sequencer
  -> localhost OSC -> VCV Rack
  -> Rack audio + camera/Rack video -> OBS
  -> transparent browser overlay -> stream
```

Optional image generation, sampling, TTS, and runtime model control publish into
the overlay. Runtime model control is disabled by default and documented in
`docs/MODEL_CONTROL.md`.

## Safety boundary

- Only allowlisted commands change musical state.
- Every model-generated command is reparsed through `parseChatCommand`.
- Model output cannot invoke image, sample, TTS, admin, shell, file, OBS, or
  YouTube lifecycle actions.
- Admin, sampler, TTS, and model-control commands are owner/mod-only by default.
- OSC hosts and the overlay bind to loopback by default.
- Existing chat history is not replayed at startup.
- OBS and Rack are live processes; do not restart them during active output
  without operator approval.
- New YouTube broadcasts should be unlisted unless the operator explicitly
  requests public for that broadcast.

## Main entry points

- `src/main.js`: service composition and event routing
- `src/model-control.js`: provider adapters and model-output validation
- `src/music.js`: command parser and bounded musical state
- `src/pattern-grammar.js`: composable musical grammar
- `src/sequencer.js`: timed OSC event generation
- `src/obs-audio.js`: microphone/camera frames and audio levels
- `public/gpu-hand-tracker.mjs`: GPU landmark tracking
- `public/overlay.html`: OBS browser overlay
- `scripts/youtube-chat-reader.py`: read-only YouTube chat feed
- `scripts/manage-chat-reader.sh`: reader lifecycle and locking
- `scripts/manage-windows-bridge.ps1`: persistent Windows bridge
- `scripts/build-rack-patch.mjs`: deterministic Rack patch builder

## Operating commands

```bash
./scripts/manage-chat-reader.sh status

BRIDGE_PS="$(wslpath -w scripts/manage-windows-bridge.ps1)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$BRIDGE_PS" -Action status

curl http://127.0.0.1:9392/healthz
```

## Overlay syntax check

```bash
node --input-type=module -e \
  "import fs from 'node:fs'; const h=fs.readFileSync('public/overlay.html','utf8'); new Function(h.match(/<script>([\\s\\S]*)<\\/script>/)[1]); console.log('overlay syntax OK')"
```

## Before publishing

1. Inspect `git status -sb` and the staged diff.
2. Confirm `.env`, OAuth files, stream keys, cookies, browser profiles, session
   JSON, generated images, and generated audio are absent.
3. Run the validation contract in `AGENTS.md`.
4. Run a secret scanner over the exact staged tree.
5. Verify repository visibility after push.
