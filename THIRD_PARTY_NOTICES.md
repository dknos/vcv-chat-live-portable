# Third-party notices

## MediaPipe Tasks Vision

This repository depends on `@mediapipe/tasks-vision` version 0.10.35 and bundles
three official MediaPipe model assets for local, offline browser inference.
MediaPipe is provided by Google under the Apache License 2.0:

- Project: https://github.com/google-ai-edge/mediapipe
- License: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

Bundled model provenance:

| File | Official source | SHA-256 |
|---|---|---|
| `public/models/hand_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |
| `public/models/pose_landmarker_lite.task` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `public/models/face_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |

The model files are unmodified copies of those sources. The application runs
them locally in the browser; camera frames are not sent to a model provider by
this repository.
