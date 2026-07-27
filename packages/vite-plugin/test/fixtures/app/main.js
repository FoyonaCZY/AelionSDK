import { AudioWorkletClock, TransferableAudioWorkletClock } from '@aelionsdk/audio';
import { WorkerCompositor } from '@aelionsdk/renderer-worker';

globalThis.__AELION_VITE_PLUGIN_FIXTURE__ = {
  AudioWorkletClock,
  TransferableAudioWorkletClock,
  WorkerCompositor,
};
