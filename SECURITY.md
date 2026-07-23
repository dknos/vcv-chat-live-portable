# Security policy

## Reporting a vulnerability

Please use this repository's private vulnerability reporting instead of opening
a public issue. Do not include API keys, OBS WebSocket passwords, YouTube
credentials, stream keys, personal paths, or other secrets in any report.

## Runtime secrets

Keep credentials in `.env` or another local secret store. The tracked
`.env.example` contains placeholders only, and `.env` is ignored by Git.

Model control is intentionally limited to parsed music commands. Model output
does not receive shell, filesystem, OBS, credential, media-generation, or
administrative authority.
