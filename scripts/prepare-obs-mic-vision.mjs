#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  connectObs,
  parseScreenshotDataUrl,
  readObsWebSocketConfig,
} from './verify-obs-phone-video.mjs';

const DEFAULT_DISPLAY_SCENE = 'Vertical Scene 1';
const DEFAULT_VISION_SCENE = 'Mic Vision Feed';
const DEFAULT_CAMERA_SOURCE = 'DroidCam OBS';

export function parseArgs(args) {
  const flags = new Map([
    ['--config', 'configFile'],
    ['--display-scene', 'displayScene'],
    ['--vision-scene', 'visionScene'],
    ['--source', 'sourceName'],
    ['--output', 'outputFile'],
  ]);
  const parsed = {
    displayScene: DEFAULT_DISPLAY_SCENE,
    visionScene: DEFAULT_VISION_SCENE,
    sourceName: DEFAULT_CAMERA_SOURCE,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const property = flags.get(flag);
    if (!property) throw new Error(`unknown argument: ${flag}`);
    if (Object.hasOwn(parsed, `_${property}`)) throw new Error(`duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    parsed[property] = value;
    parsed[`_${property}`] = true;
    index += 1;
  }
  for (const key of Object.keys(parsed)) {
    if (key.startsWith('_')) delete parsed[key];
  }
  if (!parsed.configFile) throw new Error('--config is required');
  return parsed;
}

export function writableTransform(transform = {}) {
  const allowed = [
    'alignment',
    'boundsAlignment',
    'boundsHeight',
    'boundsType',
    'boundsWidth',
    'cropBottom',
    'cropLeft',
    'cropRight',
    'cropToBounds',
    'cropTop',
    'positionX',
    'positionY',
    'rotation',
    'scaleX',
    'scaleY',
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => Object.hasOwn(transform, key))
      .filter((key) => !['boundsHeight', 'boundsWidth'].includes(key) || Number(transform[key]) >= 1)
      .map((key) => [key, transform[key]]),
  );
}

function matchingItems(items, sourceName) {
  return (items || []).filter((item) => item.sourceName === sourceName);
}

export async function prepareObsMicVision(options) {
  const server = readObsWebSocketConfig(options.configFile);
  const obs = await connectObs(server);
  try {
    const [streamStatus, recordStatus] = await Promise.all([
      obs.request('GetStreamStatus'),
      obs.request('GetRecordStatus'),
    ]);
    if (streamStatus.outputActive || recordStatus.outputActive) {
      throw new Error('refusing to change OBS vision scenes while streaming or recording');
    }
    const currentBefore = await obs.request('GetCurrentProgramScene');
    if (currentBefore.currentProgramSceneName !== options.displayScene) {
      throw new Error(
        `OBS current scene is ${currentBefore.currentProgramSceneName || 'unknown'}, not ${options.displayScene}`,
      );
    }

    const displayItems = await obs.request('GetSceneItemList', { sceneName: options.displayScene });
    const cameraItems = matchingItems(displayItems.sceneItems, options.sourceName);
    if (cameraItems.length !== 1) {
      throw new Error(
        `${options.displayScene} must contain exactly one ${options.sourceName} item; found ${cameraItems.length}`,
      );
    }
    const cameraItem = cameraItems[0];
    const transformResponse = await obs.request('GetSceneItemTransform', {
      sceneName: options.displayScene,
      sceneItemId: cameraItem.sceneItemId,
    });
    const transform = writableTransform(transformResponse.sceneItemTransform);

    const sceneList = await obs.request('GetSceneList');
    let created = false;
    if (!(sceneList.scenes || []).some((scene) => scene.sceneName === options.visionScene)) {
      await obs.request('CreateScene', { sceneName: options.visionScene });
      created = true;
    }

    let visionItems = await obs.request('GetSceneItemList', { sceneName: options.visionScene });
    const unexpected = (visionItems.sceneItems || [])
      .filter((item) => item.sourceName !== options.sourceName);
    if (unexpected.length > 0) {
      throw new Error(
        `${options.visionScene} contains unexpected sources: ${unexpected.map((item) => item.sourceName).join(', ')}`,
      );
    }
    let visionCameraItems = matchingItems(visionItems.sceneItems, options.sourceName);
    if (visionCameraItems.length > 1) {
      throw new Error(`${options.visionScene} contains duplicate ${options.sourceName} items`);
    }
    if (visionCameraItems.length === 0) {
      await obs.request('CreateSceneItem', {
        sceneName: options.visionScene,
        sourceName: options.sourceName,
        sceneItemEnabled: true,
      });
      visionItems = await obs.request('GetSceneItemList', { sceneName: options.visionScene });
      visionCameraItems = matchingItems(visionItems.sceneItems, options.sourceName);
    }
    if (visionCameraItems.length !== 1) {
      throw new Error(`could not create the ${options.sourceName} vision item`);
    }

    await obs.request('SetSceneItemTransform', {
      sceneName: options.visionScene,
      sceneItemId: visionCameraItems[0].sceneItemId,
      sceneItemTransform: transform,
    });

    if (options.outputFile) {
      const frame = await obs.request('GetSourceScreenshot', {
        sourceName: options.visionScene,
        imageFormat: 'png',
        imageWidth: 360,
        imageHeight: 640,
        imageCompressionQuality: 75,
      });
      const outputPath = path.resolve(options.outputFile);
      fs.writeFileSync(outputPath, parseScreenshotDataUrl(frame.imageData));
    }

    const currentAfter = await obs.request('GetCurrentProgramScene');
    if (currentAfter.currentProgramSceneName !== currentBefore.currentProgramSceneName) {
      throw new Error('preparing the vision feed unexpectedly changed the live scene');
    }
    return {
      created,
      displayScene: options.displayScene,
      displaySources: (displayItems.sceneItems || []).map((item) => ({
        name: item.sourceName,
        type: item.inputKind || item.sourceType,
      })),
      visionScene: options.visionScene,
      source: options.sourceName,
      transform: {
        positionX: transform.positionX,
        positionY: transform.positionY,
        rotation: transform.rotation,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
      },
      outputFile: options.outputFile ? path.resolve(options.outputFile) : undefined,
      programSceneUnchanged: true,
      outputActive: false,
    };
  } finally {
    obs.close();
  }
}

export async function main(args = process.argv.slice(2)) {
  const result = await prepareObsMicVision(parseArgs(args));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`OBS mic vision setup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
