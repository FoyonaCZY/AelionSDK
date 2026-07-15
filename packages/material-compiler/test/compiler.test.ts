import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  compileMaterialGraph,
  compileMaterialGraphToWebGl2,
  selectMaterialImplementation,
  validateMaterialInstance,
  VISUAL_NODE_SET_1_DEFINITIONS,
  type MaterialGraph,
  type RuntimeMaterialDefinition,
} from '../src/index.js';

const root = new URL('../../../', import.meta.url);

async function graph(path: string): Promise<MaterialGraph> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8')) as MaterialGraph;
}

describe('Material Graph compiler', () => {
  it('compiles the Cross Dissolve graph in topological order', async () => {
    const result = compileMaterialGraph(
      await graph('examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json'),
      {
        parameters: { curve: 'enum' },
        specializationValues: { curve: 'smooth' },
        inputPorts: { from: 'visual-frame', to: 'visual-frame' },
        systems: { transitionProgress: 'float' },
      },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.order).toEqual(['easedProgress', 'mixFrames']);
    expect(result.depth).toBe(2);
    expect(result.estimatedPasses).toBe(1);
  });

  it('compiles Warm Film and Soft Glow against the same node set', async () => {
    const warm = compileMaterialGraph(
      await graph('examples/materials/warm-film/graphs/warm-film.graph.json'),
      {
        parameters: { intensity: 'float' },
        inputPorts: { source: 'visual-frame' },
      },
    );
    const glow = compileMaterialGraph(
      await graph('examples/materials/soft-glow/graphs/soft-glow.graph.json'),
      {
        parameters: { threshold: 'float', radiusPx: 'float', intensity: 'float' },
        inputPorts: { source: 'visual-frame' },
      },
    );
    expect(warm.diagnostics).toEqual([]);
    expect(glow.diagnostics).toEqual([]);
    expect(glow.estimatedPasses).toBeGreaterThan(warm.estimatedPasses);
  });

  it('rejects dependency cycles', async () => {
    const value = await graph('examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json');
    const firstNode = value.nodes[0];
    if (firstNode === undefined) throw new Error('Fixture has no nodes');
    firstNode.inputs.progress = { node: 'mixFrames', output: 'frame' };
    const result = compileMaterialGraph(value, {
      parameters: { curve: 'enum' },
      inputPorts: { from: 'visual-frame', to: 'visual-frame' },
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MATERIAL_DEPENDENCY_CYCLE' })]),
    );
  });

  it('rejects type mismatches and missing parameters', async () => {
    const result = compileMaterialGraph(
      await graph('examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json'),
      {
        parameters: {},
        inputPorts: { from: 'float', to: 'visual-frame' },
        systems: { transitionProgress: 'float' },
      },
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MATERIAL_GRAPH_PARAMETER_MISSING' }),
        expect.objectContaining({ code: 'MATERIAL_GRAPH_TYPE_MISMATCH' }),
      ]),
    );
  });

  it('enforces the static pass budget', async () => {
    const result = compileMaterialGraph(
      await graph('examples/materials/soft-glow/graphs/soft-glow.graph.json'),
      {
        parameters: { threshold: 'float', radiusPx: 'float', intensity: 'float' },
        inputPorts: { source: 'visual-frame' },
        budget: { maxPasses: 1 },
      },
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MATERIAL_BUDGET_EXCEEDED' })]),
    );
  });

  it('defines the initial extensible Core Node registry', () => {
    expect(VISUAL_NODE_SET_1_DEFINITIONS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(VISUAL_NODE_SET_1_DEFINITIONS.map(value => value.type)).size).toBe(
      VISUAL_NODE_SET_1_DEFINITIONS.length,
    );
  });

  it('lowers Cross Dissolve and Warm Film graphs to portable WebGL2 programs', async () => {
    const transition = compileMaterialGraphToWebGl2(
      await graph('examples/materials/cross-dissolve/graphs/cross-dissolve.graph.json'),
      {
        parameters: { curve: 'enum' },
        specializationValues: { curve: 'smooth' },
        inputPorts: { from: 'visual-frame', to: 'visual-frame' },
        systems: { transitionProgress: 'float' },
      },
    );
    const filter = compileMaterialGraphToWebGl2(
      await graph('examples/materials/warm-film/graphs/warm-film.graph.json'),
      {
        parameters: { intensity: 'float' },
        inputPorts: { source: 'visual-frame' },
      },
    );
    expect(transition.inputPorts).toEqual(['from', 'to']);
    expect(transition.uniforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: { kind: 'system', id: 'transitionProgress' } }),
      ]),
    );
    expect(transition.fragmentShader).toContain('mix(');
    expect(transition.fragmentShader).toContain('smoothstep(');
    expect(transition.webgpu?.shader).toContain('textureSample(input_from');
    expect(transition.webgpu?.shader).toContain('smoothstep(');
    expect(filter.inputPorts).toEqual(['source']);
    expect(filter.uniforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: { kind: 'parameter', id: 'intensity' } }),
      ]),
    );
    expect(filter.fragmentShader).toContain('aelion_temperature');
    expect(filter.webgpu?.shader).toContain('aelion_temperature');
  });

  it('builds a real four-pass WebGL2 plan for Soft Glow', async () => {
    const program = compileMaterialGraphToWebGl2(
      await graph('examples/materials/soft-glow/graphs/soft-glow.graph.json'),
      {
        parameters: { threshold: 'float', radiusPx: 'float', intensity: 'float' },
        inputPorts: { source: 'visual-frame' },
      },
    );
    expect(program.passes?.map(value => value.id)).toEqual([
      'highlights:draw',
      'blurred:horizontal',
      'blurred:vertical',
      'composite:draw',
    ]);
    expect(program.executionPlan.passes).toHaveLength(4);
    expect(program.executionPlan.intermediateTextureCount).toBe(3);
    expect(program.webgpu).toBeUndefined();
  });

  it('validates Instance parameter boundaries, resources and auxiliary inputs', () => {
    const definition: RuntimeMaterialDefinition = {
      parameters: [
        {
          id: 'amount',
          type: 'float',
          default: 0.5,
          range: { min: 0, max: 1 },
          animatable: true,
        },
      ],
      ports: [
        {
          id: 'mask',
          direction: 'input',
          type: 'mask',
          binding: 'instance',
          required: true,
        },
      ],
      resourceSlots: [{ id: 'lut', required: true }],
      implementations: [{ type: 'graph' }],
    };
    expect(
      validateMaterialInstance(definition, {
        parameters: { amount: 0, unknown: 1 },
      }).map(value => value.code),
    ).toEqual([
      'MATERIAL_INSTANCE_INVALID',
      'MATERIAL_INSTANCE_INVALID',
      'MATERIAL_INSTANCE_INVALID',
    ]);
    expect(
      validateMaterialInstance(definition, {
        parameters: { amount: 1.001 },
        resourceBindings: { lut: { assetId: 'asset_lut' } },
        inputBindings: { mask: { assetId: 'asset_mask' } },
      }),
    ).toEqual([expect.objectContaining({ code: 'MATERIAL_PARAMETER_OUT_OF_RANGE' })]);
    expect(
      validateMaterialInstance(definition, {
        parameters: { amount: 1 },
        resourceBindings: { lut: { assetId: 'asset_lut' } },
        inputBindings: { mask: { assetId: 'asset_mask' } },
      }),
    ).toEqual([]);
  });

  it('returns stable diagnostics for unavailable backends and trusted code', () => {
    const graphDefinition: RuntimeMaterialDefinition = {
      parameters: [],
      ports: [],
      resourceSlots: [],
      implementations: [{ type: 'graph' }],
    };
    expect(
      selectMaterialImplementation(graphDefinition, { backend: 'cpu', trust: 'declarative' }),
    ).toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'MATERIAL_BACKEND_UNAVAILABLE' })],
    });
    const codeDefinition: RuntimeMaterialDefinition = {
      ...graphDefinition,
      implementations: [{ type: 'shader', backend: 'webgpu' }],
    };
    expect(
      selectMaterialImplementation(codeDefinition, { backend: 'webgpu', trust: 'declarative' }),
    ).toMatchObject({
      diagnostics: [expect.objectContaining({ code: 'MATERIAL_TRUST_REQUIRED' })],
    });
    expect(
      selectMaterialImplementation(codeDefinition, {
        backend: 'webgpu',
        trust: 'trusted-code',
        trustedCodeAuthorized: true,
      }),
    ).toMatchObject({ implementation: { type: 'shader', backend: 'webgpu' }, diagnostics: [] });
  });
});
