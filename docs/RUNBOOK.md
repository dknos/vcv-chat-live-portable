# Live runbook

## One-time setup

1. Read `AGENTS.md`.
2. Install Node and the Python chat-reader requirements.
3. Copy `.env.example` to `.env` and fill only local paths/provider settings.
4. Install the required VCV Rack modules.
5. Prepare the managed OBS profile while OBS is closed.
6. Keep every credential outside the repository.

## Rehearsal

```bash
npm run doctor
npm run check
npm test
npm run simulate
```

Run a dry bridge and submit representative commands:

```bash
npm run dry-run
```

```text
operator> !vibe psychedelic chill
operator> !tempo 112
operator> !energy 75
operator> !drop
```

Verify the overlay, microphone response, GPU tracking, OSC, Rack audio, and OBS
scene locally before connecting a broadcast.

## Attach a broadcast

Use the public video ID, never the stream key:

```bash
. .venv/bin/activate
./scripts/manage-chat-reader.sh start --broadcast VIDEO_ID
./scripts/manage-chat-reader.sh status --broadcast VIDEO_ID
```

Then start or inspect the Windows bridge:

```bash
BRIDGE_PS="$(wslpath -w scripts/manage-windows-bridge.ps1)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$BRIDGE_PS" -Action start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$BRIDGE_PS" -Action status
curl.exe http://127.0.0.1:9392/healthz
```

Do not restart OBS or Rack during active output without operator approval.

## Model control

If enabled, first test the configured provider with owner/mod chat:

```text
!ai keep the tempo, make it darker, and add space
```

Confirm the activity ticker shows only allowlisted music commands. Disable model
control immediately if provider latency or output is unreliable:

```dotenv
MODEL_CONTROL_ENABLED=0
```

Restart only the bridge to apply bridge environment changes; do not restart OBS
or Rack solely for a model-provider swap.

## During the show

- Watch `/healthz` for chat, OSC, microphone, model, and tracking status.
- Keep OBS encoder and dropped-frame metrics visible.
- Keep `!sample`, TTS, model control, and admin commands owner/mod-only.
- Use copyrighted audio only with permission.
- Do not expose the overlay beyond loopback.

Emergency chat controls:

```text
!rack mute
!rack freeze
!rack panic
```

## Stop cleanly

1. Stop OBS streaming/recording and verify acknowledgement.
2. Complete the YouTube broadcast in the operator-owned control surface.
3. Stop the chat reader:

   ```bash
   ./scripts/manage-chat-reader.sh stop
   ```

4. Stop the bridge if the session is finished.
5. Close OBS and Rack normally. Never force-stop a live output unless recovery
   requires it and the operator approves.
