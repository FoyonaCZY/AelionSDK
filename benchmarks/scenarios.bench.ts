import { bench, describe } from 'vitest';

import { ProjectValidator, type AelionProject } from '@aelionsdk/project-schema';
import { evaluateVisualState, IncrementalRenderCompiler } from '@aelionsdk/render-ir';
import {
  planTimelineMove,
  speculateProject,
  speculateProjectChange,
  TransactionEngine,
  type TransactionBuilder,
} from '@aelionsdk/transaction';

import { CLIP_DURATION_US, editingProject, midpointUs, schemas } from './fixture';

/**
 * The scenarios a host actually pays for, at a scale a host actually reaches.
 *
 * Each one is named for the interaction it stands in for rather than the
 * function it calls, because that is the number a product feels: opening a
 * project, nudging a clip, dragging one, and drawing a frame while playing.
 */

const CLIPS = 1_000;
const authored = editingProject({ clips: CLIPS });
const validator = new ProjectValidator({
  projectSchema: schemas.project,
  materialInstanceSchema: schemas.materialInstance,
});

const bootstrap = validator.validate(authored);
if (!bootstrap.ok) {
  throw new Error(`benchmark fixture is invalid: ${JSON.stringify(bootstrap.diagnostics[0])}`);
}

/**
 * The document a Session actually holds: validated, owned, and deep-frozen.
 *
 * `TransactionEngine` freezes every snapshot it publishes, so this is the shape
 * every one of these scenarios starts from in a real host. Measuring against
 * the raw authored object instead would report a state no Session is ever in.
 */
const project = deepFreeze(bootstrap.value.project);

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

const validate = (candidate: unknown): { ok: boolean; diagnostics: readonly unknown[] } => {
  const result = validator.validateAdmitted(candidate);
  return { ok: result.ok, diagnostics: result.ok ? [] : result.diagnostics };
};

const permissive = (): { ok: true; diagnostics: [] } => ({ ok: true, diagnostics: [] });

const MOVED_ITEM = 'item_v_500';
const TARGET_START_US = 40 * CLIP_DURATION_US;

describe(`open a ${CLIPS.toString()}-clip project`, () => {
  bench('validate the document', () => {
    validator.validate(authored);
  });

  bench('construct the transaction engine', () => {
    new TransactionEngine(authored, validate as never);
  });

  // What a Session does: admit and check the document once, then hand the
  // engine the snapshot it already owns.
  bench('whole load path (validate, adopt, compile)', () => {
    const admitted = validator.validate(authored);
    if (!admitted.ok) throw new Error('fixture is invalid');
    new TransactionEngine(admitted.value.project, validate as never, {
      adoptValidatedProject: true,
    });
    new IncrementalRenderCompiler().compile(admitted.value.project, 'seq_main', 0n);
  });

  bench('cold compile Render IR', () => {
    new IncrementalRenderCompiler().compile(project, 'seq_main', 0n);
  });
});

describe(`edit a ${CLIPS.toString()}-clip project`, () => {
  const engine = new TransactionEngine(project, validate as never);
  let nudge = 0;
  bench('commit one field, validated', () => {
    nudge += 1;
    engine.edit({ baseRevision: engine.revision }, edit => {
      edit.setField('items', MOVED_ITEM, ['metadata'], { nudge });
    });
  });

  const unchecked = new TransactionEngine(project, permissive as never);
  let raw = 0;
  bench('commit one field, unvalidated (floor)', () => {
    raw += 1;
    unchecked.edit({ baseRevision: unchecked.revision }, edit => {
      edit.setField('items', MOVED_ITEM, ['metadata'], { raw });
    });
  });
});

describe(`drag a clip across a ${CLIPS.toString()}-clip timeline`, () => {
  // What a host writes on a pointer move: the same fields `applyPlacements`
  // would commit, and nothing else.
  const overlay =
    (targetStartUs: number) =>
    (transaction: TransactionBuilder): void => {
      const plan = planTimelineMove(project, {
        movedItemId: MOVED_ITEM,
        targetTrackId: 'track_v1',
        targetStartUs,
      });
      if (plan === undefined) return;
      for (const [id, placement] of plan.placements) {
        const item = project.items[id];
        if (item === undefined) continue;
        if (item.trackId !== placement.trackId) {
          transaction.setField('items', id, ['trackId'], placement.trackId);
        }
        if (item.range.startUs !== placement.startUs) {
          transaction.setField('items', id, ['range', 'startUs'], placement.startUs);
        }
      }
    };

  bench('resolve the drop position', () => {
    planTimelineMove(project, {
      movedItemId: MOVED_ITEM,
      targetTrackId: 'track_v1',
      targetStartUs: TARGET_START_US,
    });
  });

  bench('speculate the Project', () => {
    speculateProject(project, overlay(TARGET_START_US));
  });

  const speculationCompiler = new IncrementalRenderCompiler();
  speculationCompiler.compile(project, 'seq_main', 0n);
  const fork = speculationCompiler.fork();
  let previousIds: readonly string[] = [];
  let pointer = 0;
  bench('one pointer move: plan, speculate and compile', () => {
    pointer += 1;
    const speculated = speculateProjectChange(project, overlay(TARGET_START_US + pointer * 1_000));
    fork.compile(speculated.project as AelionProject, 'seq_main', 1n, {
      affectedEntityIds: [...new Set([...previousIds, ...speculated.affectedEntityIds])],
    });
    previousIds = speculated.affectedEntityIds;
  });
});

describe(`play a ${CLIPS.toString()}-clip timeline`, () => {
  const { ir } = new IncrementalRenderCompiler().compile(project, 'seq_main', 0n);
  const timeUs = midpointUs(CLIPS);
  bench('evaluate the visual state of one frame', () => {
    evaluateVisualState(ir, timeUs);
  });

  let frame = 0;
  bench('evaluate 60 consecutive frames', () => {
    for (let index = 0; index < 60; index += 1) {
      frame += 33_367;
      evaluateVisualState(ir, frame % (CLIPS * CLIP_DURATION_US));
    }
  });
});

describe(`recompile a ${CLIPS.toString()}-clip project after one edit`, () => {
  const compiler = new IncrementalRenderCompiler();
  compiler.compile(project, 'seq_main', 0n);
  const edited = speculateProject(project, transaction => {
    transaction.setField('items', MOVED_ITEM, ['range', 'startUs'], 7_000_000);
  }) as AelionProject;

  bench('with the affected ids declared', () => {
    compiler.compile(edited, 'seq_main', 1n, { affectedEntityIds: [MOVED_ITEM] });
  });

  bench('without them (fingerprint fallback)', () => {
    compiler.compile(edited, 'seq_main', 1n);
  });
});
