# VCV Chat Live Portable

A credential-free, model-neutral live-performance stack for YouTube chat, VCV
Rack, OBS, microphone-reactive visuals, GPU hand/pose/face tracking, chat image
generation, sampling, TTS, and bounded AI control.

The repository contains no API keys, OAuth tokens, stream keys, cookies, browser
profiles, generated chat data, generated images, or generated audio. Runtime
credentials belong only in `.env` or another local secret store.

## Signal path

```text
YouTube live chat -> atomic session JSON -> Node safety/command bridge
                                           |-> provider-neutral model adapter
                                           |-> OSC -> VCV Rack
                                           |-> audio/GPU tracking -> OBS overlay
                                           |-> optional image/sample/TTS adapters
```

Models never receive shell, file, OBS, YouTube, credential, image, sampler, TTS,
or admin authority. `!ai` responses are parsed back through the existing
allowlisted music command layer before any OSC value changes.

## Quick start

Requirements:

- Node.js 22+
- Python 3.10+ for the included YouTube chat reader
- Windows PowerShell plus OBS and VCV Rack for the full Windows/WSL stack
- optional `yt-dlp`, FFmpeg, an image wrapper, and a model endpoint

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

Edit `.env` for local paths and devices. `.env` is ignored by Git.

## Connect YouTube chat

Start the included read-only reader with the 11-character video ID:

```bash
. .venv/bin/activate
./scripts/manage-chat-reader.sh start --broadcast VIDEO_ID
./scripts/manage-chat-reader.sh status --broadcast VIDEO_ID
```

It writes `state/live-session.json` atomically and uses an exclusive process
lock. Existing chat history is marked seen when the bridge starts, so old
commands are not replayed.

## Start the bridge

For a dry local test:

```bash
npm run dry-run
```

For a persistent Windows-native bridge launched from WSL:

```bash
BRIDGE_PS="$(wslpath -w scripts/manage-windows-bridge.ps1)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$BRIDGE_PS" -Action start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$BRIDGE_PS" -Action status
```

Open `http://127.0.0.1:9392/healthz` and
`http://127.0.0.1:9392/overlay`. The overlay server binds to loopback by default.

## Plug in any model

The built-in adapter supports:

- OpenAI-compatible APIs, including Ollama, LM Studio, llama.cpp, vLLM, and
  compatible gateways
- Anthropic Messages
- Gemini `generateContent`
- a generic JSON webhook for any custom SDK or agent

Example for a local OpenAI-compatible endpoint:

```dotenv
MODEL_CONTROL_ENABLED=1
MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_API_KEY=
MODEL_NAME=your-local-model
```

Then an owner or moderator can use:

```text
!ai make this slower, darker, and more spacious
!rack ai build toward a bright jungle drop
```

See [runtime model control](docs/MODEL_CONTROL.md) for all providers and the
generic webhook contract.

## Main chat controls

```text
!vibe psychedelic jungle
!tempo 120
!key F# minor
!scale dorian
!energy 80
!density 60
!brightness 70
!space 75
!chaos 30
!scene chill
!section build
!drop
```

`!sample`, TTS, model control, and admin commands remain owner/mod-only by
default. Image generation is serialized and rate-limited.

## OBS and Rack

- `patches/ChatRack-Live.vcv` is the canonical Rack patch.
- `scripts/build-rack-patch.mjs` rebuilds it deterministically.
- `scripts/prepare-obs.ps1` creates an isolated managed OBS profile.
- `scripts/prepare-obs-phone.ps1` creates an explicit camera scene without
  display capture.
- `scripts/configure-obs-youtube.ps1` reads `YOUTUBE_STREAM_KEY` from a
  caller-supplied local env file and never prints it.

Set these only when rebuilding the Rack patch for local hardware:

```bash
export VCV_AUDIO_DRIVER=6
export VCV_AUDIO_DEVICE='your Windows audio device'
export VCV_PIANO_SFZ='C:\path\to\piano.sfz'
export VCV_GUITAR_SFZ='C:\path\to\guitar.sfz'
```

See [Rack wiring](docs/RACK_PATCH.md), [OBS/YouTube](docs/OBS_YOUTUBE.md), and
the [runbook](docs/RUNBOOK.md).

## Handing the repo to a coding model

Any coding model or agent should read [AGENTS.md](AGENTS.md), then
[docs/LLM_HANDOFF.md](docs/LLM_HANDOFF.md). Those files define the safe operating
contract, entry points, validation sequence, and live-process boundaries without
depending on prior conversation history.

## Validation

```bash
npm run doctor
npm run check
npm test
npm run simulate
npm run build:patch
npm run build:doom
```

The patch builders require a local VCV Rack template plus `tar` and `zstd`.
