interface WebGpuDevice {
  destroy(): void;
}

interface WebGpuAdapter {
  requestDevice(): Promise<WebGpuDevice>;
}

interface WebGpuNavigator {
  requestAdapter(): Promise<WebGpuAdapter | null>;
}

let webGpuAvailable: Promise<boolean> | undefined;

export function hasUsableWebGpu(): Promise<boolean> {
  webGpuAvailable ??= (async () => {
    const gpu = Reflect.get(navigator, 'gpu') as WebGpuNavigator | undefined;
    if (gpu === undefined || typeof gpu.requestAdapter !== 'function') return false;
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter === null) return false;
      const device = await adapter.requestDevice();
      device.destroy();
      return true;
    } catch {
      return false;
    }
  })();
  return webGpuAvailable;
}
