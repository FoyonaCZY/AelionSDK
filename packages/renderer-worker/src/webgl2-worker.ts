/// <reference lib="webworker" />

import type {
  ComposeRequest,
  RendererWorkerDiagnostic,
  RendererWorkerRequest,
  RendererWorkerResourceSnapshot,
  RendererWorkerResponse,
} from './protocol.js';

interface GpuBuffer {
  destroy(): void;
  getMappedRange(): ArrayBuffer;
  mapAsync(mode: number): Promise<void>;
  unmap(): void;
}

interface GpuTexture {
  createView(): unknown;
  destroy(): void;
}

interface GpuQueue {
  copyExternalImageToTexture(
    source: { source: VideoFrame },
    destination: { texture: GpuTexture },
    copySize: [number, number],
  ): void;
  submit(commands: readonly unknown[]): void;
  writeBuffer(buffer: GpuBuffer, offset: number, data: BufferSource): void;
  onSubmittedWorkDone(): Promise<void>;
}

interface GpuPipeline {
  getBindGroupLayout(index: number): unknown;
}

interface GpuDevice {
  readonly queue: GpuQueue;
  readonly lost: Promise<{ readonly reason: string; readonly message: string }>;
  createBindGroup(descriptor: object): unknown;
  createBuffer(descriptor: object): GpuBuffer;
  createCommandEncoder(): {
    beginRenderPass(descriptor: object): {
      draw(vertexCount: number): void;
      end(): void;
      setBindGroup(index: number, bindGroup: unknown): void;
      setPipeline(pipeline: unknown): void;
    };
    copyTextureToBuffer(source: object, destination: object, size: object): void;
    finish(): unknown;
  };
  createRenderPipeline(descriptor: object): GpuPipeline;
  createSampler(descriptor: object): unknown;
  createShaderModule(descriptor: object): unknown;
  createTexture(descriptor: object): GpuTexture;
  destroy(): void;
  popErrorScope(): Promise<{ readonly message: string } | null>;
  pushErrorScope(filter: 'validation' | 'out-of-memory' | 'internal'): void;
}

class RendererBackendError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RendererBackendError';
  }
}

function emptyResources(inputFrames: number): RendererWorkerResourceSnapshot {
  return {
    activeRequests: 0,
    cancelledRequests: 0,
    webgpuDevices: 0,
    webgpuPipelines: 0,
    webgpuBuffers: 0,
    webgpuTextures: 0,
    webgl2Contexts: 0,
    webgl2Programs: 0,
    webgl2Buffers: 0,
    webgl2Textures: 0,
    inputFrames,
  };
}

function backendError(error: unknown, fallbackCode: string): RendererBackendError {
  return error instanceof RendererBackendError
    ? error
    : new RendererBackendError(
        fallbackCode,
        error instanceof Error ? error.message : 'Unknown renderer backend error',
      );
}

interface GpuNavigator extends Navigator {
  readonly gpu?: {
    requestAdapter(): Promise<{ requestDevice(): Promise<GpuDevice> } | null>;
  };
}

interface MutableWorkerTiming {
  gpuCompletionUs: number;
}

const GPU_BUFFER_USAGE = {
  COPY_DST: 0x0008,
  MAP_READ: 0x0001,
  UNIFORM: 0x0040,
};
const GPU_TEXTURE_USAGE = {
  COPY_DST: 0x0002,
  COPY_SRC: 0x0001,
  RENDER_ATTACHMENT: 0x0010,
  TEXTURE_BINDING: 0x0004,
};

let persistentGpuDevice: GpuDevice | undefined;
let persistentGpuDeviceTask: Promise<GpuDevice> | undefined;
const persistentGpuPipelines = new Map<string, GpuPipeline>();
const persistentGpuTextures = new Map<string, GpuTexture[]>();
const MAX_POOLED_GPU_TEXTURE_BYTES = 256 * 1_024 * 1_024;
let pooledGpuTextureBytes = 0;

interface AcquiredGpuTexture {
  readonly texture: GpuTexture;
  readonly key: string;
  readonly bytes: number;
}

function gpuTextureKey(width: number, height: number, usage: number): string {
  return `${width.toString()}x${height.toString()}:rgba8unorm:${usage.toString()}`;
}

function acquireGpuTexture(
  device: GpuDevice,
  width: number,
  height: number,
  usage: number,
): AcquiredGpuTexture {
  const key = gpuTextureKey(width, height, usage);
  const bytes = width * height * 4;
  const bucket = persistentGpuTextures.get(key);
  const texture = bucket?.pop();
  if (texture !== undefined) {
    pooledGpuTextureBytes -= bytes;
    if (bucket?.length === 0) persistentGpuTextures.delete(key);
    return { texture, key, bytes };
  }
  return {
    texture: device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage,
    }),
    key,
    bytes,
  };
}

function releaseGpuTexture(acquired: AcquiredGpuTexture): void {
  if (pooledGpuTextureBytes + acquired.bytes > MAX_POOLED_GPU_TEXTURE_BYTES) {
    acquired.texture.destroy();
    return;
  }
  const bucket = persistentGpuTextures.get(acquired.key) ?? [];
  bucket.push(acquired.texture);
  persistentGpuTextures.set(acquired.key, bucket);
  pooledGpuTextureBytes += acquired.bytes;
}

function clearGpuTexturePool(): void {
  persistentGpuTextures.forEach(bucket => bucket.forEach(texture => texture.destroy()));
  persistentGpuTextures.clear();
  pooledGpuTextureBytes = 0;
}

async function gpuDevice(): Promise<GpuDevice> {
  if (persistentGpuDevice !== undefined) return persistentGpuDevice;
  persistentGpuDeviceTask ??= (async () => {
    const gpu = (navigator as GpuNavigator).gpu;
    if (gpu === undefined) throw new Error('WebGPU is unavailable');
    const adapter = await gpu.requestAdapter();
    if (adapter === null) throw new Error('WebGPU adapter is unavailable');
    const device = await adapter.requestDevice();
    persistentGpuDevice = device;
    void device.lost.then(() => {
      if (persistentGpuDevice === device) {
        persistentGpuDevice = undefined;
        persistentGpuDeviceTask = undefined;
        persistentGpuPipelines.clear();
        clearGpuTexturePool();
      }
    });
    return device;
  })().catch((error: unknown) => {
    persistentGpuDeviceTask = undefined;
    throw error;
  });
  return persistentGpuDeviceTask;
}

function disposeGpuRuntime(): void {
  clearGpuTexturePool();
  persistentGpuDevice?.destroy();
  persistentGpuDevice = undefined;
  persistentGpuDeviceTask = undefined;
  persistentGpuPipelines.clear();
}

async function composeWebGpu(
  request: ComposeRequest,
  resources: RendererWorkerResourceSnapshot,
  timing: MutableWorkerTiming,
): Promise<ImageBitmap> {
  const webgpu = request.program.webgpu;
  if (webgpu === undefined) throw new Error('Material has no WebGPU program');
  const frames = webgpu.inputPorts.map(port => {
    const frame = request.inputs[port];
    if (frame === undefined) throw new Error(`WebGPU Material input ${port} is missing`);
    return frame;
  });
  const device = await gpuDevice();
  (resources as { webgpuDevices: number }).webgpuDevices += 1;
  device.pushErrorScope('validation');
  const textures: AcquiredGpuTexture[] = [];
  let uniformBuffer: GpuBuffer | undefined;
  let readback: GpuBuffer | undefined;
  try {
    const inputUsage =
      GPU_TEXTURE_USAGE.TEXTURE_BINDING |
      GPU_TEXTURE_USAGE.COPY_DST |
      GPU_TEXTURE_USAGE.RENDER_ATTACHMENT;
    const outputUsage = GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC;
    const inputTextures = frames.map(() =>
      acquireGpuTexture(device, request.width, request.height, inputUsage),
    );
    const outputTexture = acquireGpuTexture(device, request.width, request.height, outputUsage);
    textures.push(...inputTextures, outputTexture);
    (resources as { webgpuTextures: number }).webgpuTextures += textures.length;
    if (request.debugSimulateLoss === 'webgpu-device') {
      disposeGpuRuntime();
      throw new RendererBackendError(
        'RENDERER_WEBGPU_DEVICE_LOST',
        'WebGPU device was lost during composition',
      );
    }
    inputTextures.forEach((texture, index) => {
      const frame = frames[index];
      if (frame === undefined) throw new Error('WebGPU input frame is missing');
      device.queue.copyExternalImageToTexture({ source: frame }, { texture: texture.texture }, [
        request.width,
        request.height,
      ]);
    });
    const uniformData = new Float32Array(Math.max(1, webgpu.uniforms.length) * 4);
    webgpu.uniforms.forEach((uniform, index) => {
      const value =
        uniform.source.kind === 'parameter'
          ? request.parameters[uniform.source.id]
          : request.systems[uniform.source.id];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`WebGPU Material uniform ${uniform.source.id} must be finite`);
      }
      uniformData[index * 4] = value;
    });
    uniformBuffer = device.createBuffer({
      size: uniformData.byteLength,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    (resources as { webgpuBuffers: number }).webgpuBuffers += 1;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    const pipelineKey = `${request.program.graphHash}:${webgpu.shader}`;
    let pipeline = persistentGpuPipelines.get(pipelineKey);
    if (pipeline === undefined) {
      const module = device.createShaderModule({ code: webgpu.shader });
      pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
      persistentGpuPipelines.set(pipelineKey, pipeline);
    }
    (resources as { webgpuPipelines: number }).webgpuPipelines += 1;
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
        },
        ...inputTextures.map((texture, index) => ({
          binding: index + 1,
          resource: texture.texture.createView(),
        })),
        { binding: inputTextures.length + 1, resource: { buffer: uniformBuffer } },
      ],
    });
    const bytesPerRow = Math.ceil((request.width * 4) / 256) * 256;
    readback = device.createBuffer({
      size: bytesPerRow * request.height,
      usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
    });
    (resources as { webgpuBuffers: number }).webgpuBuffers += 1;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputTexture.texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: outputTexture.texture },
      { buffer: readback, bytesPerRow, rowsPerImage: request.height },
      { width: request.width, height: request.height },
    );
    device.queue.submit([encoder.finish()]);
    const gpuStartedAt = performance.now();
    await Promise.race([
      device.queue.onSubmittedWorkDone(),
      device.lost.then(info => {
        throw new RendererBackendError(
          'RENDERER_WEBGPU_DEVICE_LOST',
          `WebGPU device was lost (${info.reason}): ${info.message}`,
        );
      }),
    ]);
    timing.gpuCompletionUs += Math.round((performance.now() - gpuStartedAt) * 1_000);
    const validationError = await device.popErrorScope();
    if (validationError !== null) {
      throw new Error(`WebGPU validation failed: ${validationError.message}`);
    }
    await readback.mapAsync(1);
    const mapped = new Uint8Array(readback.getMappedRange());
    const pixels = new Uint8ClampedArray(request.width * request.height * 4);
    for (let row = 0; row < request.height; row += 1) {
      const start = row * bytesPerRow;
      pixels.set(mapped.subarray(start, start + request.width * 4), row * request.width * 4);
    }
    readback.unmap();
    const canvas = new OffscreenCanvas(request.width, request.height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('WebGPU readback canvas is unavailable');
    context.putImageData(new ImageData(pixels, request.width, request.height), 0, 0);
    return canvas.transferToImageBitmap();
  } finally {
    uniformBuffer?.destroy();
    readback?.destroy();
    textures.forEach(texture => {
      if (persistentGpuDevice === device) releaseGpuTexture(texture);
      else texture.texture.destroy();
    });
    (resources as { webgpuDevices: number }).webgpuDevices = 0;
    (resources as { webgpuPipelines: number }).webgpuPipelines = 0;
    (resources as { webgpuBuffers: number }).webgpuBuffers = 0;
    (resources as { webgpuTextures: number }).webgpuTextures = 0;
  }
}

const vertexShaderSource = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_uv;
}`;

class WebGl2Runtime {
  readonly canvas: OffscreenCanvas;
  readonly gl: WebGL2RenderingContext;
  readonly #programs = new Map<string, WebGLProgram>();
  readonly #textures: WebGLTexture[] = [];
  readonly #positionBuffer: WebGLBuffer;
  readonly #uvBuffer: WebGLBuffer;
  lastAccess = 0;

  public constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      desynchronized: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (gl === null) throw new Error('Worker WebGL2 context is unavailable');
    this.gl = gl;
    this.#positionBuffer = this.#createBuffer([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    this.#uvBuffer = this.#createBuffer([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
  }

  public program(fragmentShader: string): WebGLProgram {
    const cached = this.#programs.get(fragmentShader);
    if (cached !== undefined) return cached;
    const program = createProgram(this.gl, fragmentShader);
    this.#programs.set(fragmentShader, program);
    return program;
  }

  public bindAttributes(program: WebGLProgram): void {
    this.#bindAttribute(program, 'a_position', this.#positionBuffer);
    this.#bindAttribute(program, 'a_uv', this.#uvBuffer);
  }

  public uploadTexture(index: number, source: VideoFrame | ImageBitmap): WebGLTexture {
    const gl = this.gl;
    let texture = this.#textures[index];
    if (texture === undefined) {
      texture = gl.createTexture();
      this.#textures[index] = texture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source as unknown as TexImageSource,
    );
    return texture;
  }

  public snapshot(): {
    readonly programs: number;
    readonly textures: number;
    readonly buffers: number;
  } {
    return { programs: this.#programs.size, textures: this.#textures.length, buffers: 2 };
  }

  public dispose(): void {
    const gl = this.gl;
    this.#programs.forEach(program => gl.deleteProgram(program));
    this.#programs.clear();
    this.#textures.forEach(texture => gl.deleteTexture(texture));
    this.#textures.length = 0;
    gl.deleteBuffer(this.#positionBuffer);
    gl.deleteBuffer(this.#uvBuffer);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  #createBuffer(values: readonly number[]): WebGLBuffer {
    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(values), this.gl.STATIC_DRAW);
    return buffer;
  }

  #bindAttribute(program: WebGLProgram, name: string, buffer: WebGLBuffer): void {
    const location = this.gl.getAttribLocation(program, name);
    if (location < 0) throw new Error(`Missing WebGL attribute ${name}`);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.enableVertexAttribArray(location);
    this.gl.vertexAttribPointer(location, 2, this.gl.FLOAT, false, 0, 0);
  }
}

const MAX_WEBGL2_RUNTIMES = 2;
const webGl2Runtimes = new Map<string, WebGl2Runtime>();
let webGl2RuntimeClock = 0;

function webGl2Runtime(width: number, height: number): WebGl2Runtime {
  const key = `${width.toString()}x${height.toString()}`;
  let runtime = webGl2Runtimes.get(key);
  if (runtime?.gl.isContextLost() === true) {
    runtime.dispose();
    webGl2Runtimes.delete(key);
    runtime = undefined;
  }
  if (runtime === undefined) {
    runtime = new WebGl2Runtime(width, height);
    webGl2Runtimes.set(key, runtime);
  }
  runtime.lastAccess = ++webGl2RuntimeClock;
  while (webGl2Runtimes.size > MAX_WEBGL2_RUNTIMES) {
    const oldest = [...webGl2Runtimes.entries()].sort(
      (left, right) => left[1].lastAccess - right[1].lastAccess,
    )[0];
    if (oldest === undefined) break;
    oldest[1].dispose();
    webGl2Runtimes.delete(oldest[0]);
  }
  return runtime;
}

function disposeWebGl2Runtimes(): void {
  webGl2Runtimes.forEach(runtime => runtime.dispose());
  webGl2Runtimes.clear();
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('Unable to allocate WebGL shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragmentShaderSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown program link error';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function uniformValue(
  uniform: ComposeRequest['program']['uniforms'][number],
  request: ComposeRequest,
): number {
  const value =
    uniform.source.kind === 'parameter'
      ? request.parameters[uniform.source.id]
      : request.systems[uniform.source.id];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Material uniform ${uniform.source.id} must be a finite number`);
  }
  return value;
}

function renderWebGl2Pass(
  request: ComposeRequest,
  fragmentShader: string,
  passInputs: readonly {
    readonly sampler: string;
    readonly source: VideoFrame | ImageBitmap;
  }[],
  uniforms: ComposeRequest['program']['uniforms'],
  timing: MutableWorkerTiming,
): ImageBitmap {
  const runtime = webGl2Runtime(request.width, request.height);
  const gl = runtime.gl;
  const program = runtime.program(fragmentShader);
  gl.useProgram(program);
  runtime.bindAttributes(program);
  passInputs.forEach((input, index) => {
    gl.activeTexture(gl.TEXTURE0 + index);
    runtime.uploadTexture(index, input.source);
    gl.uniform1i(gl.getUniformLocation(program, `u_input_${input.sampler}`), index);
  });
  for (const uniform of uniforms) {
    gl.uniform1f(gl.getUniformLocation(program, uniform.name), uniformValue(uniform, request));
  }
  gl.viewport(0, 0, request.width, request.height);
  const gpuStartedAt = performance.now();
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.finish();
  timing.gpuCompletionUs += Math.round((performance.now() - gpuStartedAt) * 1_000);
  if (gl.isContextLost()) {
    webGl2Runtimes.delete(`${request.width.toString()}x${request.height.toString()}`);
    runtime.dispose();
    throw new RendererBackendError(
      'RENDERER_WEBGL_CONTEXT_LOST',
      'WebGL2 context was lost during composition',
    );
  }
  const bitmap = runtime.canvas.transferToImageBitmap();
  // Chromium may evict a context between GPU completion and bitmap transfer
  // when several tabs/workers contend for the page context budget. Never return
  // the resulting transparent/stale bitmap as a successful composition.
  if (gl.isContextLost()) {
    bitmap.close();
    webGl2Runtimes.delete(`${request.width.toString()}x${request.height.toString()}`);
    runtime.dispose();
    throw new RendererBackendError(
      'RENDERER_WEBGL_CONTEXT_LOST',
      'WebGL2 context was lost while transferring the composed frame',
    );
  }
  return bitmap;
}

function composeWebGl2MultiPass(
  request: ComposeRequest,
  resources: RendererWorkerResourceSnapshot,
  timing: MutableWorkerTiming,
): ImageBitmap {
  const passes = request.program.passes;
  if (passes === undefined || passes.length === 0) {
    throw new TypeError('Multi-pass WebGL2 program has no passes');
  }
  const outputs = new Map<string, ImageBitmap>();
  (resources as { webgl2Contexts: number }).webgl2Contexts = passes.length;
  (resources as { webgl2Programs: number }).webgl2Programs = passes.length;
  (resources as { webgl2Buffers: number }).webgl2Buffers = passes.length * 2;
  try {
    for (const pass of passes) {
      const inputs = pass.inputs.map(input => {
        const source =
          input.source.kind === 'external'
            ? request.inputs[input.source.port]
            : outputs.get(input.source.passId);
        if (source === undefined) {
          throw new RangeError(`Material pass ${pass.id} is missing input ${input.sampler}`);
        }
        return { sampler: input.sampler, source };
      });
      (resources as { webgl2Textures: number }).webgl2Textures = inputs.length;
      const bitmap = renderWebGl2Pass(request, pass.fragmentShader, inputs, pass.uniforms, timing);
      outputs.set(pass.id, bitmap);
    }
    const last = outputs.get(passes.at(-1)?.id ?? '');
    if (last === undefined) throw new Error('Multi-pass Material produced no output');
    outputs.delete(passes.at(-1)?.id ?? '');
    return last;
  } finally {
    outputs.forEach(bitmap => bitmap.close());
    (resources as { webgl2Contexts: number }).webgl2Contexts = 0;
    (resources as { webgl2Programs: number }).webgl2Programs = 0;
    (resources as { webgl2Buffers: number }).webgl2Buffers = 0;
    (resources as { webgl2Textures: number }).webgl2Textures = 0;
  }
}

function composeWebGl2(
  request: ComposeRequest,
  resources: RendererWorkerResourceSnapshot,
  timing: MutableWorkerTiming,
): ImageBitmap {
  if (
    !Number.isInteger(request.width) ||
    !Number.isInteger(request.height) ||
    request.width <= 0 ||
    request.height <= 0
  ) {
    throw new RangeError('Composition dimensions must be positive integers');
  }
  for (const port of request.program.inputPorts) {
    if (request.inputs[port] === undefined) {
      throw new RangeError(`Material input ${port} is missing`);
    }
  }
  if (request.program.passes !== undefined) {
    return composeWebGl2MultiPass(request, resources, timing);
  }
  const inputs = request.program.inputPorts.map(port => {
    const source = request.inputs[port];
    if (source === undefined) throw new RangeError(`Material input ${port} is missing`);
    return { sampler: port.replaceAll(/[^a-zA-Z0-9_]/gu, '_'), source };
  });
  if (request.debugSimulateLoss === 'webgl2-context') {
    const runtime = webGl2Runtime(request.width, request.height);
    runtime.gl.getExtension('WEBGL_lose_context')?.loseContext();
    webGl2Runtimes.delete(`${request.width.toString()}x${request.height.toString()}`);
    runtime.dispose();
    throw new RendererBackendError(
      'RENDERER_WEBGL_CONTEXT_LOST',
      'WebGL2 context was lost during composition',
    );
  }
  return renderWebGl2Pass(
    request,
    request.program.fragmentShader,
    inputs,
    request.program.uniforms,
    timing,
  );
}

async function composeWebGl2WithAdmissionRetry(
  request: ComposeRequest,
  resources: RendererWorkerResourceSnapshot,
  timing: MutableWorkerTiming,
): Promise<ImageBitmap> {
  const maxAttempts = 80;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return composeWebGl2(request, resources, timing);
    } catch (error) {
      const unavailable =
        error instanceof Error && error.message === 'Worker WebGL2 context is unavailable';
      if (!unavailable) throw error;
      if (cancelledRequestIds.has(request.id)) {
        throw new DOMException('Renderer request cancelled', 'AbortError');
      }
      if (attempt === maxAttempts - 1) {
        throw new RendererBackendError(
          'RENDERER_WEBGL_ADMISSION_TIMEOUT',
          'Timed out waiting for a page WebGL2 context budget',
        );
      }
      await new Promise(resolve => globalThis.setTimeout(resolve, 50));
    }
  }
  throw new RendererBackendError(
    'RENDERER_WEBGL_ADMISSION_TIMEOUT',
    'Timed out waiting for a page WebGL2 context budget',
  );
}

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;
const MAX_ACTIVE_REQUESTS = 8;
const activeRequestIds = new Set<number>();
const cancelledRequestIds = new Set<number>();

function finishRequest(id: number, resources: RendererWorkerResourceSnapshot): void {
  activeRequestIds.delete(id);
  cancelledRequestIds.delete(id);
  (resources as { activeRequests: number }).activeRequests = activeRequestIds.size;
  (resources as { cancelledRequests: number }).cancelledRequests = cancelledRequestIds.size;
}

function acknowledgeCancellation(id: number): void {
  worker.postMessage({ type: 'cancelled', id } satisfies RendererWorkerResponse);
}

worker.addEventListener('message', (event: MessageEvent<RendererWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'dispose') {
    disposeGpuRuntime();
    disposeWebGl2Runtimes();
    worker.close();
    return;
  }
  if (request.type === 'cancel') {
    if (activeRequestIds.has(request.id)) cancelledRequestIds.add(request.id);
    return;
  }
  if (request.type === 'inspect-resources') {
    request.responsePort.postMessage({
      activeRequests: activeRequestIds.size,
      cancelledRequests: cancelledRequestIds.size,
    });
    request.responsePort.close();
    return;
  }

  if (activeRequestIds.size >= MAX_ACTIVE_REQUESTS) {
    Object.values(request.inputs).forEach(frame => frame.close());
    worker.postMessage({
      type: 'failed',
      id: request.id,
      code: 'RENDERER_QUEUE_FULL',
      message: `Renderer Worker reached its ${MAX_ACTIVE_REQUESTS.toString()} active request limit`,
    } satisfies RendererWorkerResponse);
    return;
  }

  activeRequestIds.add(request.id);
  void (async () => {
    const workerStartedAt = performance.now();
    let response: RendererWorkerResponse;
    const diagnostics: RendererWorkerDiagnostic[] = [];
    const resources = emptyResources(Object.keys(request.inputs).length);
    const timing: MutableWorkerTiming = { gpuCompletionUs: 0 };
    let inputsClosed = false;
    const closeInputs = (): void => {
      if (inputsClosed) return;
      inputsClosed = true;
      Object.values(request.inputs).forEach(frame => frame.close());
      (resources as { inputFrames: number }).inputFrames = 0;
    };
    try {
      let bitmap: ImageBitmap;
      let backend: 'webgpu' | 'webgl2';
      if (request.preferredBackend === 'webgpu') {
        try {
          bitmap = await composeWebGpu(request, resources, timing);
          backend = 'webgpu';
        } catch (error) {
          const failure = backendError(error, 'RENDERER_WEBGPU_FAILED');
          if (!request.allowFallback) throw failure;
          diagnostics.push({ code: failure.code, message: failure.message });
          bitmap = await composeWebGl2WithAdmissionRetry(request, resources, timing);
          backend = 'webgl2';
        }
      } else {
        bitmap = await composeWebGl2WithAdmissionRetry(request, resources, timing);
        backend = 'webgl2';
      }
      closeInputs();
      if (cancelledRequestIds.has(request.id)) {
        bitmap.close();
        finishRequest(request.id, resources);
        acknowledgeCancellation(request.id);
        return;
      }
      finishRequest(request.id, resources);
      response = {
        type: 'composed',
        id: request.id,
        bitmap,
        backend,
        graphHash: request.program.graphHash,
        diagnostics,
        resources,
        outputBitmapOwner: 'caller',
        timing: {
          totalWorkerUs: Math.round((performance.now() - workerStartedAt) * 1_000),
          gpuCompletionUs: timing.gpuCompletionUs,
        },
      };
      worker.postMessage(response, [bitmap]);
    } catch (error) {
      if (cancelledRequestIds.has(request.id)) {
        finishRequest(request.id, resources);
        acknowledgeCancellation(request.id);
        return;
      }
      finishRequest(request.id, resources);
      const failure = backendError(error, 'RENDERER_WORKER_COMPOSE_FAILED');
      response = {
        type: 'failed',
        id: request.id,
        code: failure.code,
        message: failure.message,
      };
      worker.postMessage(response);
    } finally {
      closeInputs();
      finishRequest(request.id, resources);
    }
  })();
});
