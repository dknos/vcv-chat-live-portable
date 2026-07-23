# Runtime model control

The bridge can ask a configured model to translate an owner/mod request into the
same bounded music commands already accepted from chat. The model never receives
shell, file, OBS, YouTube, credential, image, sampler, TTS, or admin authority.
Every returned command is parsed again by `parseChatCommand`; invalid and admin
commands are rejected before they reach OSC.

## Enable a provider

Copy `.env.example` to `.env`, then select one provider. Keep `.env` local.

### Ollama, LM Studio, llama.cpp, vLLM, OpenRouter, or another compatible API

```dotenv
MODEL_CONTROL_ENABLED=1
MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_API_KEY=
MODEL_NAME=your-model-name
```

For a hosted OpenAI-compatible service, change `MODEL_BASE_URL`, set its model
name, and place the runtime token in `MODEL_API_KEY`.

### Anthropic

```dotenv
MODEL_CONTROL_ENABLED=1
MODEL_PROVIDER=anthropic
MODEL_BASE_URL=https://api.anthropic.com/v1
MODEL_API_KEY=
MODEL_NAME=your-anthropic-model
```

### Gemini

```dotenv
MODEL_CONTROL_ENABLED=1
MODEL_PROVIDER=gemini
MODEL_BASE_URL=https://generativelanguage.googleapis.com/v1beta
MODEL_API_KEY=
MODEL_NAME=your-gemini-model
```

### Generic webhook

Use this adapter for a model gateway with a custom SDK or API:

```dotenv
MODEL_CONTROL_ENABLED=1
MODEL_PROVIDER=webhook
MODEL_BASE_URL=http://127.0.0.1:8787/model-control
MODEL_API_KEY=
MODEL_NAME=optional-routing-name
```

The bridge sends:

```json
{
  "model": "optional-routing-name",
  "system": "bounded command instructions",
  "prompt": "operator request",
  "state": {
    "tempo": 100,
    "key": "C",
    "scale": "minor",
    "scene": "chill"
  },
  "responseSchema": {
    "commands": ["!rack tempo 120"]
  }
}
```

Return either:

```json
{"commands":["!rack scene jungle","!rack energy 80"]}
```

or:

```json
{"text":"{\"commands\":[\"!rack scene jungle\"]}"}
```

## Use it

Model control is owner/mod-only by default:

```text
!ai make this darker, slower, and spacious
!rack ai build toward a bright jungle drop
```

The model may return at most `MODEL_MAX_COMMANDS` per request. `MODEL_COOLDOWN_MS`
serializes requests and limits cost. `/healthz` reports provider readiness but
never exposes the base URL or key.

## Add another native provider

Implement its request and response shapes in `ModelClient` inside
`src/model-control.js`, add the provider name to `PROVIDERS`, and add tests using
an injected `fetchImpl`. Do not log headers, response bodies, or environment
values that may contain credentials.
