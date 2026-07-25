import { describe, expect, it } from 'vitest';

import { createComposition, seconds } from '../src/index.js';

describe('Composition product API', () => {
  it('authors reusable Material-backed Clips without exposing Project ownership rules', () => {
    const composition = createComposition({ width: 1280, height: 720 });
    const visual = composition.layer('visual', { name: 'Main' });
    const captions = composition.layer('caption', { name: 'Captions' });
    const material = composition.material({
      packageId: 'dev.aelion.tests',
      packageVersion: '1.0.0',
      packageIntegrity: `sha256:${'0'.repeat(64)}`,
      materialId: 'cross-dissolve',
      parameters: { curve: 'smooth' },
    });
    const from = visual
      .shape({
        kind: 'rectangle',
        durationUs: seconds(3),
        box: { x: 0, y: 0, width: 640, height: 720 },
        fill: '#ff0000',
      })
      .effect(material)
      .keyframes('opacity', [
        { timeUs: 0, value: 0 },
        { timeUs: seconds(1), value: 1 },
      ]);
    const to = visual.shape({
      kind: 'ellipse',
      atUs: seconds(2),
      durationUs: seconds(3),
      box: { x: 640, y: 0, width: 640, height: 720 },
      fill: '#0000ff',
    });
    visual
      .text({
        text: 'Aelion',
        durationUs: seconds(5),
      })
      .mask(from, { featherPx: 4 });
    captions.caption({
      text: 'One API, portable Project',
      durationUs: seconds(2),
    });
    composition.transition(from, to, material, {
      atUs: seconds(2),
      durationUs: seconds(1),
    });

    const project = composition.build();
    expect(
      Object.values(project.items)
        .map(item => item.type)
        .sort(),
    ).toEqual(['caption', 'shape', 'shape', 'text']);
    expect(Object.keys(project.materialInstances)).toHaveLength(2);
    expect(Object.keys(project.transitions)).toHaveLength(1);
  });

  it('rejects content added to an incompatible Layer', () => {
    const composition = createComposition();
    const audio = composition.layer('audio');
    expect(() =>
      audio.text({
        text: 'not audio',
        durationUs: seconds(1),
      }),
    ).toThrow(/visual Layer/u);
  });
});
