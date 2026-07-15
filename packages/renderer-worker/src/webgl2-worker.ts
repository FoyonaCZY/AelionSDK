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
  createRenderPipeline(descriptor: object): {
    getBindGroupLayout(index: number): unknown;
  };
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
  const gpu = (navigator as GpuNavigator).gpu;
  if (gpu === undefined) throw new Error('WebGPU is unavailable');
  const adapter = await gpu.requestAdapter();
  if (adapter === null) throw new Error('WebGPU adapter is unavailable');
  const device = await adapter.requestDevice();
  (resources as { webgpuDevices: number }).webgpuDevices += 1;
  device.pushErrorScope('validation');
  const textures: GpuTexture[] = [];
  let uniformBuffer: GpuBuffer | undefined;
  let readback: GpuBuffer | undefined;
  try {
    const textureDescriptor = {
      size: { width: request.width, height: request.height },
      format: 'rgba8unorm',
      usage:
        GPU_TEXTURE_USAGE.TEXTURE_BINDING |
        GPU_TEXTURE_USAGE.COPY_DST |
        GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
    };
    const inputTextures = frames.map(() => device.createTexture(textureDescriptor));
    const outputTexture = device.createTexture({
      ...textureDescriptor,
      usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.COPY_SRC,
    });
    textures.push(...inputTextures, outputTexture);
    (resources as { webgpuTextures: number }).webgpuTextures += textures.length;
    if (request.debugSimulateLoss === 'webgpu-device') {
      device.destroy();
      throw new RendererBackendError(
        'RENDERER_WEBGPU_DEVICE_LOST',
        'WebGPU device was lost during composition',
      );
    }
    inputTextures.forEach((texture, index) => {
      const frame = frames[index];
      if (frame === undefined) throw new Error('WebGPU input frame is missing');
      device.queue.copyExternalImageToTexture({ source: frame }, { texture }, [
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
    const module = device.createShaderModule({ code: webgpu.shader });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
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
          resource: texture.createView(),
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
          view: outputTexture.createView(),
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
      { texture: outputTexture },
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
    textures.forEach(texture => texture.destroy());
    device.destroy();
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

function createTexture(gl: WebGL2RenderingContext, frame: VideoFrame | ImageBitmap): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    frame as unknown as TexImageSource,
  );
  return texture;
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
  const canvas = new OffscreenCanvas(request.width, request.height);
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    desynchronized: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (gl === null) throw new Error('Worker WebGL2 context is unavailable');
  const program = createProgram(gl, fragmentShader);
  const buffers: WebGLBuffer[] = [];
  const textures: WebGLTexture[] = [];
  try {
    gl.useProgram(program);
    buffers.push(
      bindAttribute(gl, program, 'a_position', [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      bindAttribute(gl, program, 'a_uv', [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    );
    passInputs.forEach((input, index) => {
      gl.activeTexture(gl.TEXTURE0 + index);
      textures.push(createTexture(gl, input.source));
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
      throw new RendererBackendError(
        'RENDERER_WEBGL_CONTEXT_LOST',
        'WebGL2 context was lost during composition',
      );
    }
    return canvas.transferToImageBitmap();
  } finally {
    buffers.forEach(buffer => gl.deleteBuffer(buffer));
    textures.forEach(texture => gl.deleteTexture(texture));
    gl.deleteProgram(program);
  }
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

function bindAttribute(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  values: readonly number[],
): WebGLBuffer {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Missing WebGL attribute ${name}`);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  return buffer;
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

  const canvas = new OffscreenCanvas(request.width, request.height);
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    desynchronized: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (gl === null) throw new Error('Worker WebGL2 context is unavailable');
  (resources as { webgl2Contexts: number }).webgl2Contexts += 1;
  const program = createProgram(gl, request.program.fragmentShader);
  (resources as { webgl2Programs: number }).webgl2Programs += 1;
  const buffers: WebGLBuffer[] = [];
  const textures: WebGLTexture[] = [];
  try {
    gl.useProgram(program);
    buffers.push(
      bindAttribute(gl, program, 'a_position', [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      bindAttribute(gl, program, 'a_uv', [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    );
    (resources as { webgl2Buffers: number }).webgl2Buffers += buffers.length;

    request.program.inputPorts.forEach((port, index) => {
      const frame = request.inputs[port];
      if (frame === undefined) throw new RangeError(`Material input ${port} is missing`);
      gl.activeTexture(gl.TEXTURE0 + index);
      textures.push(createTexture(gl, frame));
      gl.uniform1i(
        gl.getUniformLocation(program, `u_input_${port.replaceAll(/[^a-zA-Z0-9_]/gu, '_')}`),
        index,
      );
    });
    (resources as { webgl2Textures: number }).webgl2Textures += textures.length;
    if (request.debugSimulateLoss === 'webgl2-context') {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      throw new RendererBackendError(
        'RENDERER_WEBGL_CONTEXT_LOST',
        'WebGL2 context was lost during composition',
      );
    }
    for (const uniform of request.program.uniforms) {
      gl.uniform1f(gl.getUniformLocation(program, uniform.name), uniformValue(uniform, request));
    }
    gl.viewport(0, 0, request.width, request.height);
    const gpuStartedAt = performance.now();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.finish();
    timing.gpuCompletionUs += Math.round((performance.now() - gpuStartedAt) * 1_000);
    if (gl.isContextLost()) {
      throw new RendererBackendError(
        'RENDERER_WEBGL_CONTEXT_LOST',
        'WebGL2 context was lost during composition',
      );
    }
    return canvas.transferToImageBitmap();
  } finally {
    buffers.forEach(buffer => gl.deleteBuffer(buffer));
    textures.forEach(texture => gl.deleteTexture(texture));
    gl.deleteProgram(program);
    (resources as { webgl2Contexts: number }).webgl2Contexts = 0;
    (resources as { webgl2Programs: number }).webgl2Programs = 0;
    (resources as { webgl2Buffers: number }).webgl2Buffers = 0;
    (resources as { webgl2Textures: number }).webgl2Textures = 0;
  }
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
          bitmap = composeWebGl2(request, resources, timing);
          backend = 'webgl2';
        }
      } else {
        bitmap = composeWebGl2(request, resources, timing);
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
