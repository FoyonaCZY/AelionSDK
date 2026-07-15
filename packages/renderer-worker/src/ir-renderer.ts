import { AelionError, type Disposable, throwIfAborted } from '@aelion/core';
import type { WebGl2MaterialProgram } from '@aelion/material-compiler';
import {
  evaluateMaterialInstance,
  evaluateVisualState,
  type IrMaterialInstance,
  type RenderIr,
} from '@aelion/render-ir';

import { WorkerCompositor, type ComposeOptions, type WorkerCompositorSnapshot } from './client.js';
import type { ComposeSuccess } from './protocol.js';

export type RenderMode = 'preview' | 'export';

export interface IrFrameSource {
  frameAt(
    assetId: string,
    streamIndex: number,
    sourceTimeUs: number,
    signal?: AbortSignal,
  ): Promise<VideoFrame>;
}

export interface RenderIrFrameOptions {
  readonly ir: RenderIr;
  readonly timeUs: number;
  readonly source: IrFrameSource;
  readonly mode: RenderMode;
  readonly preferredBackend?: 'webgpu' | 'webgl2';
  readonly allowFallback?: boolean;
  readonly signal?: AbortSignal;
}

export interface RenderIrFrameResult {
  readonly bitmap: ImageBitmap;
  readonly backend: 'webgpu' | 'webgl2';
  readonly materialIds: readonly string[];
}

export interface RenderIrFrameRendererOptions {
  /** Maximum full frame evaluations in flight. Defaults to 2. */
  readonly maxPendingFrames?: number;
}

export interface RenderIrFrameRendererSnapshot {
  readonly disposed: boolean;
  readonly pendingFrames: number;
  readonly maxPendingFrames: number;
  readonly worker: WorkerCompositorSnapshot;
}

interface LinkedAbortSignal {
  readonly signal: AbortSignal;
  readonly detach: () => void;
}

function linkAbortSignals(first: AbortSignal | undefined, second: AbortSignal): LinkedAbortSignal {
  if (first === undefined) return { signal: second, detach: () => undefined };
  const controller = new AbortController();
  const abortFromFirst = (): void => controller.abort(first.reason);
  const abortFromSecond = (): void => controller.abort(second.reason);
  if (first.aborted) abortFromFirst();
  else if (second.aborted) abortFromSecond();
  else {
    first.addEventListener('abort', abortFromFirst, { once: true });
    second.addEventListener('abort', abortFromSecond, { once: true });
  }
  return {
    signal: controller.signal,
    detach: () => {
      first.removeEventListener('abort', abortFromFirst);
      second.removeEventListener('abort', abortFromSecond);
    },
  };
}

function requiredProgram(material: IrMaterialInstance, mode: RenderMode) {
  if (material.program !== undefined) return material.program;
  if (mode === 'preview' && material.previewPolicy === 'skippable-when-degraded') return undefined;
  throw new Error(`Material ${material.id} has no executable backend`);
}

/** Converts an owned compositor result and releases the source on every path. */
function takeBitmapFrame(bitmap: ImageBitmap, timestampUs: number): VideoFrame {
  try {
    return new VideoFrame(bitmap, { timestamp: timestampUs });
  } finally {
    bitmap.close();
  }
}

async function presentationBitmap(
  frame: VideoFrame,
  signal: AbortSignal | undefined,
): Promise<ImageBitmap> {
  // A WebGL canvas exports premultiplied RGBA. Normalizing the public bitmap to
  // straight alpha prevents some headless Chromium/ANGLE paths from applying
  // alpha a second time when callers present it through Canvas 2D.
  const bitmap = await createImageBitmap(frame, { premultiplyAlpha: 'none' });
  try {
    throwIfAborted(signal, 'Render IR presentation');
    return bitmap;
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

const BASE_VISUAL_PROGRAM: WebGl2MaterialProgram = {
  backend: 'webgl2',
  nodeSet: 'aelion.visual.builtin/1.0.0',
  graphHash: 'builtin-visual-transform-v1',
  inputPorts: ['source'],
  uniforms: [
    'positionX',
    'positionY',
    'anchorX',
    'anchorY',
    'scaleX',
    'scaleY',
    'rotationRad',
    'opacity',
    'outputWidth',
    'outputHeight',
    'cropLeft',
    'cropTop',
    'cropRight',
    'cropBottom',
  ].map(id => ({
    name: `u_parameter_${id}`,
    type: 'float' as const,
    source: { kind: 'parameter' as const, id },
  })),
  executionPlan: {
    passes: [
      {
        id: 'builtin-visual-transform',
        kind: 'draw',
        nodes: ['builtin-visual-transform'],
        estimatedTextureSamples: 1,
      },
    ],
    intermediateTextureCount: 0,
  },
  fragmentShader: `#version 300 es
precision highp float;
uniform sampler2D u_input_source;
uniform float u_parameter_positionX;
uniform float u_parameter_positionY;
uniform float u_parameter_anchorX;
uniform float u_parameter_anchorY;
uniform float u_parameter_scaleX;
uniform float u_parameter_scaleY;
uniform float u_parameter_rotationRad;
uniform float u_parameter_opacity;
uniform float u_parameter_outputWidth;
uniform float u_parameter_outputHeight;
uniform float u_parameter_cropLeft;
uniform float u_parameter_cropTop;
uniform float u_parameter_cropRight;
uniform float u_parameter_cropBottom;
in vec2 v_uv;
out vec4 out_color;
void main() {
  vec2 position = vec2(
    u_parameter_positionX / u_parameter_outputWidth,
    u_parameter_positionY / u_parameter_outputHeight
  );
  vec2 offset = v_uv - position;
  float c = cos(-u_parameter_rotationRad);
  float s = sin(-u_parameter_rotationRad);
  vec2 rotated = mat2(c, -s, s, c) * offset;
  vec2 sourceUv = rotated / vec2(u_parameter_scaleX, u_parameter_scaleY)
    + vec2(u_parameter_anchorX, u_parameter_anchorY);
  vec2 cropMin = vec2(u_parameter_cropLeft, u_parameter_cropTop);
  vec2 cropMax = vec2(1.0 - u_parameter_cropRight, 1.0 - u_parameter_cropBottom);
  if (any(lessThan(sourceUv, cropMin)) || any(greaterThan(sourceUv, cropMax))) {
    out_color = vec4(0.0);
  } else {
    out_color = texture(u_input_source, sourceUv) * u_parameter_opacity;
  }
}`,
};

const ALPHA_OVER_PROGRAM: WebGl2MaterialProgram = {
  backend: 'webgl2',
  nodeSet: 'aelion.visual.builtin/1.0.0',
  graphHash: 'builtin-alpha-over-v1',
  inputPorts: ['base', 'overlay'],
  uniforms: [],
  executionPlan: {
    passes: [
      {
        id: 'builtin-alpha-over',
        kind: 'draw',
        nodes: ['builtin-alpha-over'],
        estimatedTextureSamples: 2,
      },
    ],
    intermediateTextureCount: 0,
  },
  fragmentShader: `#version 300 es
precision highp float;
uniform sampler2D u_input_base;
uniform sampler2D u_input_overlay;
in vec2 v_uv;
out vec4 out_color;
void main() {
  vec4 base = texture(u_input_base, v_uv);
  vec4 overlay = texture(u_input_overlay, v_uv);
  out_color = overlay + base * (1.0 - overlay.a);
}`,
};

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function visualParameters(
  visual: object,
  width: number,
  height: number,
): Readonly<Record<string, number>> {
  const visualRecord = visual as Readonly<Record<string, unknown>>;
  const transform = record(visualRecord.transform);
  const position = record(transform.positionPx);
  const anchor = record(transform.anchor);
  const scale = record(transform.scale);
  const crop = record(visualRecord.crop);
  return {
    positionX: finite(position.x, width / 2),
    positionY: finite(position.y, height / 2),
    anchorX: finite(anchor.x, 0.5),
    anchorY: finite(anchor.y, 0.5),
    scaleX: finite(scale.x, 1),
    scaleY: finite(scale.y, 1),
    rotationRad: (finite(transform.rotationDeg, 0) * Math.PI) / 180,
    opacity: Math.max(0, Math.min(1, finite(visualRecord.opacity, 1))),
    outputWidth: width,
    outputHeight: height,
    cropLeft: finite(crop.left, 0),
    cropTop: finite(crop.top, 0),
    cropRight: finite(crop.right, 0),
    cropBottom: finite(crop.bottom, 0),
  };
}

function requiresBaseVisualPass(
  parameters: Readonly<Record<string, number>>,
  width: number,
  height: number,
): boolean {
  return (
    parameters.positionX !== width / 2 ||
    parameters.positionY !== height / 2 ||
    parameters.anchorX !== 0.5 ||
    parameters.anchorY !== 0.5 ||
    parameters.scaleX !== 1 ||
    parameters.scaleY !== 1 ||
    parameters.rotationRad !== 0 ||
    parameters.opacity !== 1 ||
    parameters.cropLeft !== 0 ||
    parameters.cropTop !== 0 ||
    parameters.cropRight !== 0 ||
    parameters.cropBottom !== 0
  );
}

export class RenderIrFrameRenderer implements Disposable {
  readonly #compositor = new WorkerCompositor();
  readonly #disposeController = new AbortController();
  readonly #maxPendingFrames: number;
  readonly #renderTasks = new Map<symbol, Promise<RenderIrFrameResult>>();
  #disposeTask: Promise<void> | undefined;
  #pendingFrames = 0;

  public constructor(options: RenderIrFrameRendererOptions = {}) {
    this.#maxPendingFrames = options.maxPendingFrames ?? 2;
    if (!Number.isSafeInteger(this.#maxPendingFrames) || this.#maxPendingFrames <= 0) {
      throw new RangeError('maxPendingFrames must be a positive safe integer');
    }
  }

  public get disposed(): boolean {
    return this.#compositor.disposed;
  }

  public snapshot(): RenderIrFrameRendererSnapshot {
    return {
      disposed: this.disposed,
      pendingFrames: this.#pendingFrames,
      maxPendingFrames: this.#maxPendingFrames,
      worker: this.#compositor.snapshot(),
    };
  }

  public async render(options: RenderIrFrameOptions): Promise<RenderIrFrameResult> {
    if (this.disposed) throw new ReferenceError('RenderIrFrameRenderer is disposed');
    const linked = linkAbortSignals(options.signal, this.#disposeController.signal);
    throwIfAborted(linked.signal, 'Render IR frame');
    if (this.#pendingFrames >= this.#maxPendingFrames) {
      linked.detach();
      throw new AelionError([
        {
          code: 'RENDERER_FRAME_QUEUE_FULL',
          severity: 'error',
          message: `Render IR frame queue reached its ${this.#maxPendingFrames.toString()} request limit`,
          recoverable: true,
        },
      ]);
    }
    this.#pendingFrames += 1;
    const token = Symbol('render-task');
    const task = (async () => {
      try {
        return await this.#renderFrame({ ...options, signal: linked.signal });
      } finally {
        linked.detach();
        this.#pendingFrames -= 1;
        this.#renderTasks.delete(token);
      }
    })();
    this.#renderTasks.set(token, task);
    return await task;
  }

  async #renderFrame(options: RenderIrFrameOptions): Promise<RenderIrFrameResult> {
    const state = evaluateVisualState(options.ir, options.timeUs);
    if (state.clips.length === 0)
      throw new RangeError(`No visual clip is active at ${options.timeUs}`);
    const rendered = new Map<string, VideoFrame>();
    const appliedMaterialIds: string[] = [];
    try {
      for (const active of state.clips) {
        if (active.sourceTimeUs === null) continue;
        let frame: VideoFrame | undefined = await options.source.frameAt(
          active.clip.source.assetId,
          active.clip.source.streamIndex,
          active.sourceTimeUs,
          options.signal,
        );
        try {
          throwIfAborted(options.signal, 'Render IR media decode');
          const baseParameters = visualParameters(
            active.clip.visual,
            options.ir.width,
            options.ir.height,
          );
          if (requiresBaseVisualPass(baseParameters, options.ir.width, options.ir.height)) {
            const input = frame;
            // WorkerCompositor owns every input once compose() is invoked,
            // including its rejected/aborted admission paths.
            frame = undefined;
            const base = await this.#composeOwned({
              inputs: { source: input },
              program: BASE_VISUAL_PROGRAM,
              parameters: baseParameters,
              width: options.ir.width,
              height: options.ir.height,
              preferredBackend: 'webgl2',
              allowFallback: false,
              ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
            frame = takeBitmapFrame(base.bitmap, options.timeUs);
          }
          for (const material of active.materials) {
            const program = requiredProgram(material, options.mode);
            if (program === undefined) continue;
            const evaluated = evaluateMaterialInstance(
              material,
              options.timeUs,
              active.clip.range.startUs,
            );
            const input = frame;
            frame = undefined;
            const result = await this.#composeOwned({
              inputs: { source: input },
              program,
              parameters: evaluated.parameters,
              width: options.ir.width,
              height: options.ir.height,
              preferredBackend: options.preferredBackend ?? 'webgpu',
              allowFallback: options.allowFallback ?? true,
              ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
            frame = takeBitmapFrame(result.bitmap, options.timeUs);
            appliedMaterialIds.push(material.id);
          }
          const previous = rendered.get(active.clip.id);
          if (previous !== undefined) previous.close();
          rendered.set(active.clip.id, frame);
          frame = undefined;
        } finally {
          frame?.close();
        }
      }

      let transitionBackend: ComposeSuccess['backend'] | undefined;
      let transitionLayerId: string | undefined;
      const layerIds = state.clips.map(active => active.clip.id);
      if (state.transition !== undefined) {
        const from = rendered.get(state.transition.transition.fromItemId);
        const to = rendered.get(state.transition.transition.toItemId);
        if (from === undefined || to === undefined) {
          throw new Error(`Transition ${state.transition.transition.id} is missing an input frame`);
        }
        const program = requiredProgram(state.transition.material, options.mode);
        if (program === undefined) throw new Error('A transition Material cannot be skipped');
        const evaluated = evaluateMaterialInstance(
          state.transition.material,
          options.timeUs,
          state.transition.transition.range.startUs,
        );
        transitionLayerId = `transition:${state.transition.transition.id}`;
        rendered.delete(state.transition.transition.fromItemId);
        rendered.delete(state.transition.transition.toItemId);
        const transitionResult = await this.#composeOwned({
          inputs: { from, to },
          program,
          parameters: evaluated.parameters,
          systems: { transitionProgress: state.transition.progress },
          width: options.ir.width,
          height: options.ir.height,
          preferredBackend: options.preferredBackend ?? 'webgpu',
          allowFallback: options.allowFallback ?? true,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        transitionBackend = transitionResult.backend;
        rendered.set(transitionLayerId, takeBitmapFrame(transitionResult.bitmap, options.timeUs));
        appliedMaterialIds.push(state.transition.material.id);
        const fromIndex = layerIds.indexOf(state.transition.transition.fromItemId);
        const toIndex = layerIds.indexOf(state.transition.transition.toItemId);
        const insertionIndex = Math.max(0, Math.min(fromIndex, toIndex));
        const withoutInputs = layerIds.filter(
          id =>
            id !== state.transition?.transition.fromItemId &&
            id !== state.transition?.transition.toItemId,
        );
        withoutInputs.splice(insertionIndex, 0, transitionLayerId);
        layerIds.splice(0, layerIds.length, ...withoutInputs);
      }

      const layers = layerIds.flatMap(id => {
        const frame = rendered.get(id);
        return frame === undefined ? [] : [{ id, frame }];
      });
      if (layers.length === 0) throw new Error('No decodable visual frame is active');

      const firstLayer = layers[0];
      if (firstLayer === undefined) throw new Error('No base visual frame is active');
      let composite: VideoFrame | undefined = firstLayer.frame;
      rendered.delete(firstLayer.id);
      try {
        for (let index = 1; index < layers.length; index += 1) {
          const layer = layers[index];
          if (layer === undefined) continue;
          rendered.delete(layer.id);
          const base = composite;
          composite = undefined;
          const result = await this.#composeOwned({
            inputs: { base, overlay: layer.frame },
            program: ALPHA_OVER_PROGRAM,
            width: options.ir.width,
            height: options.ir.height,
            preferredBackend: 'webgl2',
            allowFallback: false,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          composite = takeBitmapFrame(result.bitmap, options.timeUs);
        }

        return {
          bitmap: await presentationBitmap(composite, options.signal),
          backend: layers.length > 1 ? 'webgl2' : (transitionBackend ?? 'webgl2'),
          materialIds: appliedMaterialIds,
        };
      } finally {
        composite?.close();
      }
    } finally {
      rendered.forEach(frame => frame.close());
    }
  }

  public dispose(): Promise<void> {
    if (this.#disposeTask !== undefined) return this.#disposeTask;
    this.#disposeController.abort(
      new DOMException('RenderIrFrameRenderer was disposed', 'AbortError'),
    );
    this.#compositor.dispose();
    const tasks = [...this.#renderTasks.values()];
    this.#disposeTask = Promise.allSettled(tasks).then(() => undefined);
    return this.#disposeTask;
  }

  async #composeOwned(options: ComposeOptions): Promise<ComposeSuccess> {
    // No asynchronous code can interleave this state check with compose()'s
    // synchronous admission. Once admitted, WorkerCompositor closes or transfers
    // every input; only this already-disposed path retains local ownership.
    if (this.#compositor.disposed) {
      new Set(Object.values(options.inputs)).forEach(frame => frame.close());
      throw new ReferenceError('WorkerCompositor is disposed');
    }
    const result = await this.#compositor.compose(options);
    try {
      throwIfAborted(options.signal, 'Render IR composition');
      return result;
    } catch (error) {
      result.bitmap.close();
      throw error;
    }
  }
}
