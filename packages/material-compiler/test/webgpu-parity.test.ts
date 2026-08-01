import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  compileMaterialGraphToWebGpu,
  compileMaterialGraphToWebGl2,
  type MaterialGraph,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);

async function graph(path: string): Promise<MaterialGraph> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as MaterialGraph;
}

const crossDissolveOptions = {
  parameters: { curve: 'enum' },
  specializationValues: { curve: 'smooth' },
  inputPorts: { from: 'visual-frame', to: 'visual-frame' },
  systems: { transitionProgress: 'float' },
};

describe('WebGPU / WebGL2 Material parity', () => {
  it('compiles the Cross Dissolve graph on both backends', async () => {
    const graphDoc = await graph(
      'examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json',
    );
    const webgl2 = compileMaterialGraphToWebGl2(graphDoc, crossDissolveOptions);
    const webgpu = compileMaterialGraphToWebGpu(graphDoc, crossDissolveOptions);
    expect(webgl2.nodeSet).toBe(webgpu.nodeSet);
    expect(webgpu.backend).toBe('webgpu');
    expect(webgpu.shader).toContain('@fragment');
    expect(webgpu.inputPorts).toEqual(expect.arrayContaining(['from', 'to']));
    // Both backends plan the same single draw pass for this graph.
    expect(webgl2.executionPlan.passes.map(pass => pass.kind)).toEqual(['draw']);
    expect(webgpu.executionPlan.passes.map(pass => pass.kind)).toEqual(['draw']);
  });

  it('compiles the warm-film graph on both backends (single-pass color chain)', async () => {
    const graphDoc = await graph('examples/materials/warm-film/graphs/warm-film.graph.json');
    const options = { parameters: { intensity: 'float' }, inputPorts: { source: 'visual-frame' } };
    const webgl2 = compileMaterialGraphToWebGl2(graphDoc, options);
    const webgpu = compileMaterialGraphToWebGpu(graphDoc, options);
    expect(webgpu.shader.length).toBeGreaterThan(0);
    expect(webgl2.fragmentShader.length).toBeGreaterThan(0);
  });

  it('fails closed on WebGPU for a multi-pass blur graph while WebGL2 succeeds', async () => {
    const graphDoc = await graph('examples/materials/soft-glow/graphs/soft-glow.graph.json');
    const webgl2 = compileMaterialGraphToWebGl2(graphDoc, {
      parameters: { threshold: 'float', radiusPx: 'float', intensity: 'float' },
      inputPorts: { source: 'visual-frame' },
    });
    expect(webgl2.passes?.map(value => value.id)).toEqual([
      'highlights:draw',
      'blurred:horizontal',
      'blurred:vertical',
      'composite:draw',
    ]);
    expect(() =>
      compileMaterialGraphToWebGpu(graphDoc, {
        parameters: { threshold: 'float', radiusPx: 'float', intensity: 'float' },
        inputPorts: { source: 'visual-frame' },
      }),
    ).toThrow(/MATERIAL_BACKEND_UNAVAILABLE/);
  });
});
