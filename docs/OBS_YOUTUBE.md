# OBS and YouTube setup

The OBS helpers manage only the dedicated `VCV Rack Live` profile and scene
collection. They do not read another OBS profile, use display capture, or embed
a stream key in this repository.

## Prepare the managed profile

Close OBS first:

```powershell
scripts\prepare-obs.ps1 -ValidateOnly
scripts\prepare-obs.ps1
```

The managed rack scene contains:

- `Rack.exe` application audio
- Rack-only window capture
- the loopback browser overlay

For a camera performance, run `scripts\prepare-obs-phone.ps1` after setting the
camera source parameters it documents. Phone/camera audio should remain disabled
when the dedicated performance microphone or Rack audio is in the OBS mix.

## Configure YouTube without committing the key

Create a local file outside the repository containing:

```dotenv
YOUTUBE_STREAM_KEY=
```

Restrict that file to the operator account, fill its value locally, and pass the
path explicitly:

```powershell
scripts\configure-obs-youtube.ps1 -EnvFile C:\secure\youtube.env -ValidateOnly
scripts\configure-obs-youtube.ps1 -EnvFile C:\secure\youtube.env
```

The script validates the managed profile, writes its `service.json`, and never
prints the stream key. The local credential file and OBS-generated service file
must never be committed.

## Start and inspect OBS

```powershell
# Preview only
scripts\start-obs.ps1 -Mode rack

# Use the managed hotkey helper only after checking the intended output
scripts\send-obs-hotkey.ps1 -Action StartRecording
scripts\send-obs-hotkey.ps1 -Action StopRecording
scripts\send-obs-hotkey.ps1 -Action StartStreaming
scripts\send-obs-hotkey.ps1 -Action StopStreaming
```

The helpers verify OBS acknowledgement from the current log. `stop-obs.ps1`
refuses to close OBS while streaming or recording.

## YouTube lifecycle

Create and manage broadcasts in YouTube Studio or through an operator-owned
OAuth tool outside this repository. Default new broadcasts to **unlisted**.
Public visibility must be an explicit decision for that individual broadcast.

For each broadcast:

1. Copy only the public watch URL or video ID into the chat-reader command.
2. Verify the chat reader targets that exact ID.
3. Verify `/healthz`, microphone/audio response, tracking mode, and OBS sources.
4. Start ingestion.
5. Transition the broadcast live only after YouTube preview is healthy.
6. Stop OBS output, complete the broadcast, and stop the chat reader.

Never paste a stream key, OAuth token, cookie, or browser profile into a model
prompt, issue, commit, or log.
