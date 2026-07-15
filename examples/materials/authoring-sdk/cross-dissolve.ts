import {
  MaterialRegistry,
  materialDefinition,
  materialGraph,
  packMaterialPackage,
} from '@aelion/material-sdk';

const graph = materialGraph(g => {
  const eased = g.transitionCurve(
    'easedProgress',
    g.systemFloat('transitionProgress'),
    g.parameterEnum('curve'),
  );
  const result = g.mix('mixFrames', g.inputFrame('from'), g.inputFrame('to'), eased);
  g.output('result', result);
});

const material = materialDefinition({
  id: 'cross-dissolve-authored',
  kind: 'visual-transition',
  display: { name: 'Cross Dissolve Authored', category: 'transition' },
})
  .enumParameter('curve', {
    default: 'smooth',
    values: ['linear', 'smooth'],
    affects: 'specialization',
  })
  .graph('graphs/cross-dissolve-authored.graph.json', graph)
  .build();

const packed = await packMaterialPackage({
  metadata: {
    id: 'dev.example.transitions',
    version: '1.0.0',
    displayName: 'Example Transitions',
    publisher: { id: 'dev.example', name: 'Example Publisher' },
    license: 'MIT',
    engines: { aelion: '>=0.1.0 <1.0.0', nodeSet: 'aelion.visual.nodes/1.0.0' },
    trust: 'declarative',
  },
  materials: [material],
});

const registry = new MaterialRegistry();
await registry.install(packed, { expectedIntegrity: packed.integrity });

export { material, packed, registry };
