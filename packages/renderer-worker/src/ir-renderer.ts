import { AelionError, type Disposable, throwIfAborted } from '@aelion/core';
import type { WebGl2MaterialProgram } from '@aelion/material-compiler';
import {
  evaluateMaterialInstance,
  evaluateAnimatedValue,
  evaluateVisualState,
  layoutIrText,
  LOCAL_RGBA8_COLOR_CAPABILITY,
  preflightColorPipeline,
  type IrMaterialInstance,
  type IrTextClip,
  type PortableTextStyle,
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

const BLEND_PROGRAM: WebGl2MaterialProgram = {
  backend: 'webgl2',
  nodeSet: 'aelion.visual.builtin/1.0.0',
  graphHash: 'builtin-blend-v1',
  inputPorts: ['base', 'overlay'],
  uniforms: [
    {
      name: 'u_parameter_blendMode',
      type: 'float',
      source: { kind: 'parameter', id: 'blendMode' },
    },
  ],
  executionPlan: {
    passes: [
      {
        id: 'builtin-blend',
        kind: 'draw',
        nodes: ['builtin-blend'],
        estimatedTextureSamples: 2,
      },
    ],
    intermediateTextureCount: 0,
  },
  fragmentShader: `#version 300 es
precision highp float;
uniform sampler2D u_input_base;
uniform sampler2D u_input_overlay;
uniform float u_parameter_blendMode;
in vec2 v_uv;
out vec4 out_color;
vec3 blendColor(vec3 b, vec3 s, int mode) {
  if (mode == 1) return b * s;
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (mode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (mode == 4) return min(b, s);
  if (mode == 5) return max(b, s);
  if (mode == 6) return min(vec3(1.0), b / max(vec3(0.00001), 1.0 - s));
  if (mode == 7) return 1.0 - min(vec3(1.0), (1.0 - b) / max(vec3(0.00001), s));
  if (mode == 8) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
  if (mode == 9) {
    vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(max(b, vec3(0.0))), step(0.25, b));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
  }
  if (mode == 10) return abs(b - s);
  if (mode == 11) return b + s - 2.0 * b * s;
  return s;
}
void main() {
  vec4 base = texture(u_input_base, v_uv);
  vec4 overlay = texture(u_input_overlay, v_uv);
  vec3 b = base.a > 0.0 ? base.rgb / base.a : vec3(0.0);
  vec3 s = overlay.a > 0.0 ? overlay.rgb / overlay.a : vec3(0.0);
  vec3 blended = blendColor(b, s, int(floor(u_parameter_blendMode + 0.5)));
  out_color = vec4(
    (1.0 - overlay.a) * base.rgb + (1.0 - base.a) * overlay.rgb + base.a * overlay.a * blended,
    overlay.a + base.a * (1.0 - overlay.a)
  );
}`,
  webgpu: {
    backend: 'webgpu',
    nodeSet: 'aelion.visual.builtin/1.0.0',
    graphHash: 'builtin-blend-v1',
    inputPorts: ['base', 'overlay'],
    uniforms: [
      {
        name: 'u_parameter_blendMode',
        type: 'float',
        source: { kind: 'parameter', id: 'blendMode' },
      },
    ],
    executionPlan: {
      passes: [
        {
          id: 'builtin-blend',
          kind: 'draw',
          nodes: ['builtin-blend'],
          estimatedTextureSamples: 2,
        },
      ],
      intermediateTextureCount: 0,
    },
    shader: `
struct Uniforms { values: array<vec4f, 1> };
@group(0) @binding(0) var source_sampler: sampler;
@group(0) @binding(1) var input_base: texture_2d<f32>;
@group(0) @binding(2) var input_overlay: texture_2d<f32>;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uvs = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  return VertexOut(vec4f(positions[index], 0.0, 1.0), uvs[index]);
}
fn blendColor(b: vec3f, s: vec3f, mode: i32) -> vec3f {
  if (mode == 1) { return b * s; }
  if (mode == 2) { return vec3f(1.0) - (vec3f(1.0) - b) * (vec3f(1.0) - s); }
  if (mode == 3) { return mix(2.0 * b * s, vec3f(1.0) - 2.0 * (vec3f(1.0) - b) * (vec3f(1.0) - s), step(vec3f(0.5), b)); }
  if (mode == 4) { return min(b, s); }
  if (mode == 5) { return max(b, s); }
  if (mode == 6) { return min(vec3f(1.0), b / max(vec3f(0.00001), vec3f(1.0) - s)); }
  if (mode == 7) { return vec3f(1.0) - min(vec3f(1.0), (vec3f(1.0) - b) / max(vec3f(0.00001), s)); }
  if (mode == 8) { return mix(2.0 * b * s, vec3f(1.0) - 2.0 * (vec3f(1.0) - b) * (vec3f(1.0) - s), step(vec3f(0.5), s)); }
  if (mode == 9) {
    let d = mix(((16.0 * b - vec3f(12.0)) * b + vec3f(4.0)) * b, sqrt(max(b, vec3f(0.0))), step(vec3f(0.25), b));
    return mix(b - (vec3f(1.0) - 2.0 * s) * b * (vec3f(1.0) - b), b + (2.0 * s - vec3f(1.0)) * (d - b), step(vec3f(0.5), s));
  }
  if (mode == 10) { return abs(b - s); }
  if (mode == 11) { return b + s - 2.0 * b * s; }
  return s;
}
@fragment fn fs(vertex: VertexOut) -> @location(0) vec4f {
  let base = textureSample(input_base, source_sampler, vertex.uv);
  let overlay = textureSample(input_overlay, source_sampler, vertex.uv);
  let b = select(vec3f(0.0), base.rgb / base.a, base.a > 0.0);
  let s = select(vec3f(0.0), overlay.rgb / overlay.a, overlay.a > 0.0);
  let blended = blendColor(b, s, i32(floor(uniforms.values[0].x + 0.5)));
  return vec4f(
    (1.0 - overlay.a) * base.rgb + (1.0 - base.a) * overlay.rgb + base.a * overlay.a * blended,
    overlay.a + base.a * (1.0 - overlay.a)
  );
}
`,
  },
};

const BLEND_MODE_CODES: Readonly<Record<string, number>> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  'color-dodge': 6,
  'color-burn': 7,
  'hard-light': 8,
  'soft-light': 9,
  difference: 10,
  exclusion: 11,
};

const MASK_PROGRAM: WebGl2MaterialProgram = {
  backend: 'webgl2',
  nodeSet: 'aelion.visual.builtin/1.0.0',
  graphHash: 'builtin-mask-v1',
  inputPorts: ['source', 'mask'],
  uniforms: ['maskMode', 'invert', 'featherUvX', 'featherUvY'].map(id => ({
    name: `u_parameter_${id}`,
    type: 'float' as const,
    source: { kind: 'parameter' as const, id },
  })),
  executionPlan: {
    passes: [
      {
        id: 'builtin-mask',
        kind: 'draw',
        nodes: ['builtin-mask'],
        estimatedTextureSamples: 10,
      },
    ],
    intermediateTextureCount: 0,
  },
  fragmentShader: `#version 300 es
precision highp float;
uniform sampler2D u_input_source;
uniform sampler2D u_input_mask;
uniform float u_parameter_maskMode;
uniform float u_parameter_invert;
uniform float u_parameter_featherUvX;
uniform float u_parameter_featherUvY;
in vec2 v_uv;
out vec4 out_color;
float maskValue(vec2 uv) {
  vec4 value = texture(u_input_mask, uv);
  return u_parameter_maskMode < 0.5 ? value.a : dot(value.rgb, vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  vec2 radius = vec2(u_parameter_featherUvX, u_parameter_featherUvY);
  float amount = 0.0;
  amount += maskValue(v_uv);
  amount += maskValue(v_uv + vec2(radius.x, 0.0));
  amount += maskValue(v_uv - vec2(radius.x, 0.0));
  amount += maskValue(v_uv + vec2(0.0, radius.y));
  amount += maskValue(v_uv - vec2(0.0, radius.y));
  amount += maskValue(v_uv + radius);
  amount += maskValue(v_uv - radius);
  amount += maskValue(v_uv + vec2(radius.x, -radius.y));
  amount += maskValue(v_uv + vec2(-radius.x, radius.y));
  amount /= 9.0;
  if (u_parameter_invert > 0.5) amount = 1.0 - amount;
  out_color = texture(u_input_source, v_uv) * clamp(amount, 0.0, 1.0);
}`,
};

function blendModeCode(mode: string): number {
  const code = BLEND_MODE_CODES[mode];
  if (code === undefined) throw new TypeError(`BLEND_MODE_UNSUPPORTED: ${mode}`);
  return code;
}

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
  sequenceTimeUs: number,
  ownerStartUs: number,
): Readonly<Record<string, number>> {
  const visualRecord = visual as Readonly<Record<string, unknown>>;
  const transform = record(visualRecord.transform);
  const evaluated = (value: unknown): unknown =>
    evaluateAnimatedValue(value as import('@aelion/core').JsonValue, sequenceTimeUs, ownerStartUs);
  const position = record(evaluated(transform.positionPx));
  const anchor = record(evaluated(transform.anchor));
  const scale = record(evaluated(transform.scale));
  const crop = record(evaluated(visualRecord.crop));
  return {
    positionX: finite(position.x, width / 2),
    positionY: finite(position.y, height / 2),
    anchorX: finite(anchor.x, 0.5),
    anchorY: finite(anchor.y, 0.5),
    scaleX: finite(scale.x, 1),
    scaleY: finite(scale.y, 1),
    rotationRad: (finite(evaluated(transform.rotationDeg), 0) * Math.PI) / 180,
    opacity: Math.max(0, Math.min(1, finite(evaluated(visualRecord.opacity), 1))),
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

function canvasFont(style: PortableTextStyle): string {
  const families = style.fontFamilies
    .map(value => (/^[\w-]+$/u.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`))
    .join(', ');
  return `${style.fontStyle} ${style.fontWeight.toString()} ${style.fontSizePx.toString()}px ${families}`;
}

function rasterTextFrame(
  clip: IrTextClip,
  width: number,
  height: number,
  timestampUs: number,
): VideoFrame {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('TEXT_CANVAS_UNAVAILABLE');
  const layout = layoutIrText(clip);
  context.clearRect(0, 0, width, height);
  context.save();
  if (clip.overflow !== 'visible') {
    context.beginPath();
    context.rect(clip.box.x, clip.box.y, clip.box.width, clip.box.height);
    context.clip();
  }
  context.textBaseline = 'top';
  for (const line of layout.lines) {
    for (const span of line.spans) {
      context.font = canvasFont(span.style);
      context.fillStyle = span.style.fill;
      const y = line.y + Math.max(0, (line.height - span.style.lineHeightPx) / 2);
      if (span.style.stroke !== undefined && span.style.strokeWidthPx > 0) {
        context.strokeStyle = span.style.stroke;
        context.lineWidth = span.style.strokeWidthPx;
        context.strokeText(span.text, span.x, y);
      }
      context.fillText(span.text, span.x, y);
    }
  }
  context.restore();
  return new VideoFrame(canvas, { timestamp: timestampUs });
}

function linearChannelToSrgb(value: number): number {
  const channel = Math.max(0, Math.min(1, value));
  return channel <= 0.003_130_8 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function canvasColor(value: unknown, fallback = 'rgba(0, 0, 0, 0)'): string {
  const color = record(value);
  const rgba = color.rgba;
  if (!Array.isArray(rgba) || rgba.length !== 4) return fallback;
  const values = rgba.map(value => finite(value, 0));
  const red = values[0];
  const green = values[1];
  const blue = values[2];
  const alpha = values[3];
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
    return fallback;
  }
  return `rgba(${Math.round(linearChannelToSrgb(red) * 255).toString()}, ${Math.round(linearChannelToSrgb(green) * 255).toString()}, ${Math.round(linearChannelToSrgb(blue) * 255).toString()}, ${Math.max(0, Math.min(1, alpha)).toString()})`;
}

function rasterBackgroundFrame(ir: RenderIr, timestampUs: number): VideoFrame {
  const canvas = new OffscreenCanvas(ir.width, ir.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('BACKGROUND_CANVAS_UNAVAILABLE');
  context.fillStyle = canvasColor(ir.backgroundColor);
  context.fillRect(0, 0, ir.width, ir.height);
  return new VideoFrame(canvas, { timestamp: timestampUs });
}

function rasterGeneratorFrame(
  generator: object,
  width: number,
  height: number,
  timestampUs: number,
): VideoFrame {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('GENERATOR_CANVAS_UNAVAILABLE');
  const properties = generator as Readonly<Record<string, unknown>>;
  const colors = Array.isArray(properties.colors) ? properties.colors : [];
  if (properties.kind === 'linear-gradient' && colors.length > 1) {
    const radians = (finite(properties.angleDeg, 0) * Math.PI) / 180;
    const radius = Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height;
    const centerX = width / 2;
    const centerY = height / 2;
    const x = (Math.cos(radians) * radius) / 2;
    const y = (Math.sin(radians) * radius) / 2;
    const gradient = context.createLinearGradient(
      centerX - x,
      centerY - y,
      centerX + x,
      centerY + y,
    );
    colors.forEach((color, index) => {
      gradient.addColorStop(index / (colors.length - 1), canvasColor(color));
    });
    context.fillStyle = gradient;
  } else {
    context.fillStyle = canvasColor(colors[0], 'rgba(0, 0, 0, 0)');
  }
  context.fillRect(0, 0, width, height);
  return new VideoFrame(canvas, { timestamp: timestampUs });
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
    const color = preflightColorPipeline(options.ir, LOCAL_RGBA8_COLOR_CAPABILITY);
    if (!color.ok) throw new AelionError(color.issues);
    const state = evaluateVisualState(options.ir, options.timeUs);
    const backgroundId = '__aelion_background__';
    const rendered = new Map<string, VideoFrame>([
      [backgroundId, rasterBackgroundFrame(options.ir, options.timeUs)],
    ]);
    const appliedMaterialIds: string[] = [];
    try {
      for (const active of state.clips) {
        if (active.clip.kind === 'adjustment-clip') continue;
        let frame: VideoFrame | undefined;
        if (active.clip.kind === 'visual-clip') {
          if (active.sourceTimeUs === null) continue;
          frame = await options.source.frameAt(
            active.clip.source.assetId,
            active.clip.source.streamIndex,
            active.sourceTimeUs,
            options.signal,
          );
        } else if (active.clip.kind === 'text-clip') {
          frame = rasterTextFrame(active.clip, options.ir.width, options.ir.height, options.timeUs);
        } else if (active.clip.kind === 'generator-clip') {
          frame = rasterGeneratorFrame(
            active.clip.generator,
            options.ir.width,
            options.ir.height,
            options.timeUs,
          );
        } else {
          if (active.sourceTimeUs === null) continue;
          const subgraph = options.ir.subgraphs?.[active.clip.source.sequenceId];
          if (subgraph === undefined) {
            throw new ReferenceError(`NESTED_SEQUENCE_MISSING: ${active.clip.source.sequenceId}`);
          }
          const nested = await this.#renderFrame({
            ...options,
            ir: subgraph,
            timeUs: active.sourceTimeUs,
          });
          frame = takeBitmapFrame(nested.bitmap, options.timeUs);
          appliedMaterialIds.push(...nested.materialIds);
        }
        try {
          throwIfAborted(options.signal, 'Render IR media decode');
          const baseParameters = visualParameters(
            active.clip.visual,
            options.ir.width,
            options.ir.height,
            options.timeUs,
            active.clip.range.startUs,
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

      const consumedMaskIds = new Set<string>();
      for (const active of state.clips) {
        if (active.clip.kind === 'adjustment-clip') continue;
        const mask = active.clip.visual.mask;
        if (mask === undefined) continue;
        const target = rendered.get(active.clip.id);
        const maskSource = rendered.get(mask.sourceItemId);
        if (target === undefined || maskSource === undefined) {
          throw new ReferenceError(
            `MASK_SOURCE_MISSING: ${active.clip.id} -> ${mask.sourceItemId}`,
          );
        }
        rendered.delete(active.clip.id);
        let ownedMask = maskSource.clone();
        if (mask.space === 'source') {
          const targetSpace = visualParameters(
            active.clip.visual,
            options.ir.width,
            options.ir.height,
            options.timeUs,
            active.clip.range.startUs,
          );
          if (requiresBaseVisualPass(targetSpace, options.ir.width, options.ir.height)) {
            try {
              const aligned = await this.#composeOwned({
                inputs: { source: ownedMask },
                program: BASE_VISUAL_PROGRAM,
                parameters: targetSpace,
                width: options.ir.width,
                height: options.ir.height,
                preferredBackend: 'webgl2',
                allowFallback: false,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
              });
              ownedMask = takeBitmapFrame(aligned.bitmap, options.timeUs);
            } catch (error) {
              target.close();
              throw error;
            }
          }
        }
        const result = await this.#composeOwned({
          inputs: { source: target, mask: ownedMask },
          program: MASK_PROGRAM,
          parameters: {
            maskMode: mask.channel === 'luma' ? 1 : 0,
            invert: mask.invert ? 1 : 0,
            featherUvX: mask.featherPx / options.ir.width,
            featherUvY: mask.featherPx / options.ir.height,
          },
          width: options.ir.width,
          height: options.ir.height,
          preferredBackend: 'webgl2',
          allowFallback: false,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        rendered.set(active.clip.id, takeBitmapFrame(result.bitmap, options.timeUs));
        if (mask.consumeSource) consumedMaskIds.add(mask.sourceItemId);
      }

      let transitionBackend: ComposeSuccess['backend'] | undefined;
      let transitionLayerId: string | undefined;
      const layerIds = [
        backgroundId,
        ...state.clips.map(active => active.clip.id).filter(id => !consumedMaskIds.has(id)),
      ];
      const blendModes = new Map([
        [backgroundId, 'normal'] as const,
        ...state.clips.map(active => [active.clip.id, active.clip.visual.blendMode] as const),
      ]);
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
        blendModes.set(transitionLayerId, 'normal');
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
        return frame === undefined
          ? []
          : [{ id, frame, blendMode: blendModes.get(id) ?? 'normal' }];
      });
      if (layers.length === 0) throw new Error('No decodable visual frame is active');

      const firstLayer = layers[0];
      if (firstLayer === undefined) throw new Error('No base visual frame is active');
      let composite: VideoFrame | undefined = firstLayer.frame;
      let compositeBackend = transitionBackend ?? 'webgl2';
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
            program: BLEND_PROGRAM,
            parameters: { blendMode: blendModeCode(layer.blendMode) },
            width: options.ir.width,
            height: options.ir.height,
            preferredBackend: options.preferredBackend ?? 'webgpu',
            allowFallback: options.allowFallback ?? true,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          composite = takeBitmapFrame(result.bitmap, options.timeUs);
          compositeBackend = result.backend;
        }

        for (const active of state.clips) {
          if (active.clip.kind !== 'adjustment-clip' || active.materials.length === 0) continue;
          let original: VideoFrame | undefined = composite.clone();
          try {
            for (const material of active.materials) {
              const program = requiredProgram(material, options.mode);
              if (program === undefined) continue;
              const evaluated = evaluateMaterialInstance(
                material,
                options.timeUs,
                active.clip.range.startUs,
              );
              const input = composite;
              composite = undefined;
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
              composite = takeBitmapFrame(result.bitmap, options.timeUs);
              compositeBackend = result.backend;
              appliedMaterialIds.push(material.id);
            }
            const adjustmentParameters = visualParameters(
              active.clip.visual,
              options.ir.width,
              options.ir.height,
              options.timeUs,
              active.clip.range.startUs,
            );
            if (requiresBaseVisualPass(adjustmentParameters, options.ir.width, options.ir.height)) {
              const adjustedInput = composite;
              composite = undefined;
              const adjusted = await this.#composeOwned({
                inputs: { source: adjustedInput },
                program: BASE_VISUAL_PROGRAM,
                parameters: adjustmentParameters,
                width: options.ir.width,
                height: options.ir.height,
                preferredBackend: 'webgl2',
                allowFallback: false,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
              });
              const overlay = takeBitmapFrame(adjusted.bitmap, options.timeUs);
              const base = original;
              original = undefined;
              const blended = await this.#composeOwned({
                inputs: { base, overlay },
                program: BLEND_PROGRAM,
                parameters: { blendMode: 0 },
                width: options.ir.width,
                height: options.ir.height,
                preferredBackend: options.preferredBackend ?? 'webgpu',
                allowFallback: options.allowFallback ?? true,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
              });
              composite = takeBitmapFrame(blended.bitmap, options.timeUs);
              compositeBackend = blended.backend;
            }
          } finally {
            original?.close();
          }
        }

        return {
          bitmap: await presentationBitmap(composite, options.signal),
          backend: compositeBackend,
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
