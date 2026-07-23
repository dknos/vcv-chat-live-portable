# Agent operating guide

This repository is the complete handoff for the VCV Chat Live system. Start with
`README.md`, then `docs/LLM_HANDOFF.md`. Do not depend on prior chat history.

## Safe operating rules

- Default every newly created YouTube broadcast to **unlisted**. Only use public
  when the operator explicitly requests it for that broadcast.
- Never commit `.env`, cookies, OAuth tokens, stream keys, browser profiles, or
  generated chat/session data.
- Treat model-provider keys and webhook authorization values as credentials.
  Keep them only in `.env` or the process environment and never print them.
- Treat OBS and VCV Rack as live processes. Do not restart either while streaming
  unless the operator explicitly approves a brief reconnect.
- Prefer restarting only `scripts/manage-windows-bridge.ps1` for bridge changes.
- Keep rack-mode OBS video capture bound to `Rack.exe`. Phone mode may use only
  the explicitly managed `droidcam_obs` source. Never use display capture.
- Keep `!sample` owner/mod-only by default and use it only for owned, licensed,
  public-domain, or otherwise reusable audio.
- Preserve existing worktree changes and stage files explicitly.

## Validation contract

Before publishing changes, run:

```bash
npm run doctor
npm run check
npm test
npm run simulate
npm run build:patch   # required when patch-builder or Rack wiring changes
```

The generated Rack patch, OSC channel count, docs, and tests must agree. The
overlay JavaScript is inline, so also compile it with the syntax check documented
in `docs/LLM_HANDOFF.md` after changing `public/overlay.html`.

## Main entry points

- `src/main.js`: bridge orchestration and event routing
- `src/model-control.js`: provider adapters and bounded model-command validation
- `src/music.js`: commands, bounded musical state, and trusted controls
- `src/pattern-grammar.js`: composable musical grammar
- `src/sequencer.js`: timed event generation and OSC output
- `src/sample-command.js`: four-second owner/mod YouTube sampler
- `src/image-command.js`: Grok image commands and image-stage controls
- `public/overlay.html`: portrait OBS overlay, visualizer, ticker, and WebAudio
- `scripts/build-rack-patch.mjs`: deterministic VCV patch builder
- `scripts/prepare-obs.ps1`: credential-free managed OBS profile generator
- `scripts/youtube-chat-reader.py`: generic read-only YouTube chat session writer

Machine-specific operator helpers may exist locally. Do not publish them until
they are generalized, credential-audited, and documented.
