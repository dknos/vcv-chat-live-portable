const MODEL_URL = '/models/hand_landmarker.task';
const POSE_MODEL_URL = '/models/pose_landmarker_lite.task';
const FACE_MODEL_URL = '/models/face_landmarker.task';
const WASM_ROOT = '/vendor/mediapipe/wasm';

function webGlRenderer() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    failIfMajorPerformanceCaveat: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (!gl) return { available: false, hardware: false, renderer: 'WEBGL2 UNAVAILABLE' };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(
    debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
  );
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return {
    available: true,
    hardware: !/swiftshader|software|llvmpipe/i.test(renderer),
    renderer,
  };
}

export async function createGpuHandTracker({
  numHands = 4,
  minHandDetectionConfidence = 0.56,
  minHandPresenceConfidence = 0.52,
  minTrackingConfidence = 0.56,
} = {}) {
  const webgl = webGlRenderer();
  if (!webgl.available || !webgl.hardware) {
    throw new Error(`hardware WebGL2 unavailable (${webgl.renderer})`);
  }
  const { FilesetResolver, HandLandmarker } = await import('/vendor/mediapipe/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const handLandmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands,
    minHandDetectionConfidence,
    minHandPresenceConfidence,
    minTrackingConfidence,
  });
  let lastTimestamp = 0;
  return {
    delegate: 'GPU',
    renderer: webgl.renderer,
    detect(image, timestamp = performance.now()) {
      const nextTimestamp = Math.max(lastTimestamp + 1, Math.round(Number(timestamp) || performance.now()));
      lastTimestamp = nextTimestamp;
      return handLandmarker.detectForVideo(image, nextTimestamp);
    },
  };
}

export async function createGpuPoseTracker({
  minPoseDetectionConfidence = 0.5,
  minPosePresenceConfidence = 0.5,
  minTrackingConfidence = 0.56,
} = {}) {
  const webgl = webGlRenderer();
  if (!webgl.available || !webgl.hardware) {
    throw new Error(`hardware WebGL2 unavailable (${webgl.renderer})`);
  }
  const { FilesetResolver, PoseLandmarker } = await import('/vendor/mediapipe/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: POSE_MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence,
    minPosePresenceConfidence,
    minTrackingConfidence,
    outputSegmentationMasks: false,
  });
  let lastTimestamp = 0;
  return {
    delegate: 'GPU',
    renderer: webgl.renderer,
    detect(image, timestamp = performance.now()) {
      const nextTimestamp = Math.max(lastTimestamp + 1, Math.round(Number(timestamp) || performance.now()));
      lastTimestamp = nextTimestamp;
      return poseLandmarker.detectForVideo(image, nextTimestamp);
    },
  };
}

export async function createGpuFaceTracker({
  minFaceDetectionConfidence = 0.5,
  minFacePresenceConfidence = 0.5,
  minTrackingConfidence = 0.55,
} = {}) {
  const webgl = webGlRenderer();
  if (!webgl.available || !webgl.hardware) {
    throw new Error(`hardware WebGL2 unavailable (${webgl.renderer})`);
  }
  const { FaceLandmarker, FilesetResolver } = await import('/vendor/mediapipe/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: FACE_MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence,
    minFacePresenceConfidence,
    minTrackingConfidence,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  let lastTimestamp = 0;
  return {
    connections: FaceLandmarker.FACE_LANDMARKS_TESSELATION,
    delegate: 'GPU',
    renderer: webgl.renderer,
    detect(image, timestamp = performance.now()) {
      const nextTimestamp = Math.max(lastTimestamp + 1, Math.round(Number(timestamp) || performance.now()));
      lastTimestamp = nextTimestamp;
      return faceLandmarker.detectForVideo(image, nextTimestamp);
    },
  };
}
