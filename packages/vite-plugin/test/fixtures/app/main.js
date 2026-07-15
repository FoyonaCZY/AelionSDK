import { AudioWorkletClock, TransferableAudioWorkletClock } from '@aelion/audio';
import { WorkerCompositor } from '@aelion/renderer-worker';

globalThis.__AELION_VITE_PLUGIN_FIXTURE__ = {
  AudioWorkletClock,
  TransferableAudioWorkletClock,
  WorkerCompositor,
};
