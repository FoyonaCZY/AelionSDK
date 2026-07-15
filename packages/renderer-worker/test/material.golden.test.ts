import { compileMaterialGraphToWebGl2, type MaterialGraph } from '@aelion/material-compiler';
import { describe, expect, it } from 'vitest';

const transition: MaterialGraph = {
  $schema: 'https://schemas.aelion.dev/material/graph/v1.json',
  graphVersion: '1.0.0',
  nodeSet: 'aelion.visual.nodes/1.0.0',
  nodes: [
    {
      id: 'curve',
      type: 'time.transition-curve',
      typeVersion: '1.0.0',
      inputs: {
        progress: { system: 'transitionProgress' },
        curve: { parameter: 'curve' },
      },
    },
    {
      id: 'result',
      type: 'composite.mix',
      typeVersion: '1.0.0',
      inputs: {
        a: { inputPort: 'from' },
        b: { inputPort: 'to' },
        amount: { node: 'curve', output: 'value' },
      },
    },
  ],
  outputs: { result: { node: 'result', output: 'frame' } },
};

describe('Material compiler deterministic golden', () => {
  it('emits stable shader identity for the frozen Cross Dissolve graph', () => {
    const program = compileMaterialGraphToWebGl2(transition, {
      parameters: { curve: 'enum' },
      specializationValues: { curve: 'smooth' },
      inputPorts: { from: 'visual-frame', to: 'visual-frame' },
      systems: { transitionProgress: 'float' },
    });
    expect({
      backend: program.backend,
      graphHash: program.graphHash,
      inputPorts: program.inputPorts,
      uniforms: program.uniforms,
      shader: program.fragmentShader,
    }).toMatchSnapshot();
  });
});
