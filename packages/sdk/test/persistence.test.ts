import { canonicalHash } from '@aelionsdk/project-schema';
import { describe, expect, it, vi } from 'vitest';

import {
  AelionSession,
  MemoryProjectRevisionStore,
  PROJECT_REVISION_RECORD_VERSION,
  ProjectPersistenceController,
  createProject,
  restoreLatestProject,
  type ProjectRevisionStore,
} from '../src/index.js';

function project() {
  const builder = createProject({
    projectId: 'persistent_project',
    sequenceId: 'main',
    title: 'Before',
  });
  return builder.build();
}

describe('revision-driven Project persistence', () => {
  it('flushes the latest transaction revision and restores a verified canonical Project', async () => {
    const store = new MemoryProjectRevisionStore();
    const source = new AelionSession();
    await source.loadProject(project());
    const persistence = await ProjectPersistenceController.attach(source, store, {
      debounceMs: 60_000,
      saveInitial: false,
      now: () => 123,
    });
    source.transaction.edit(transaction => {
      transaction.setField('sequences', 'main', ['name'], 'After one');
    });
    source.transaction.edit(transaction => {
      transaction.setField('sequences', 'main', ['name'], 'After two');
    });
    await persistence.flush();

    const record = await store.loadLatest('persistent_project');
    expect(record).toMatchObject({
      version: PROJECT_REVISION_RECORD_VERSION,
      generation: 1,
      sourceRevision: '2',
      savedAtEpochMs: 123,
    });
    expect(record?.canonicalProject).toContain('"name":"After two"');
    expect(persistence.getSnapshot()).toMatchObject({
      pendingRevision: null,
      lastSavedRevision: 2n,
      generation: 1,
      error: undefined,
    });

    const restored = new AelionSession();
    const result = await restoreLatestProject(restored, store, 'persistent_project');
    if (result === null) throw new Error('Expected the Project revision to be restored');
    expect(result.record.sourceRevision).toBe('2');
    expect(restored.getSnapshot().project?.sequences.main?.name).toBe('After two');
    await expect(canonicalHash(result.project)).resolves.toBe(record?.contentHash);

    await persistence.dispose();
    await source.dispose();
    await restored.dispose();
  });

  it('continues the durable generation after a restored Session revision restarts at zero', async () => {
    const store = new MemoryProjectRevisionStore();
    const first = new AelionSession();
    await first.loadProject(project());
    const firstPersistence = await ProjectPersistenceController.attach(first, store, {
      debounceMs: 0,
    });
    await firstPersistence.flush();
    await firstPersistence.dispose();
    await first.dispose();

    const second = new AelionSession();
    await restoreLatestProject(second, store, 'persistent_project');
    expect(second.revision).toBe(0n);
    const secondPersistence = await ProjectPersistenceController.attach(second, store, {
      debounceMs: 60_000,
      saveInitial: false,
    });
    second.transaction.edit(transaction => {
      transaction.setField('sequences', 'main', ['name'], 'New session');
    });
    await secondPersistence.dispose();
    expect(await store.loadLatest('persistent_project')).toMatchObject({
      generation: 2,
      sourceRevision: '1',
    });
    await second.dispose();
  });

  it('reports storage failures and refuses hash-corrupted recovery', async () => {
    const errors: unknown[] = [];
    const failingStore: ProjectRevisionStore = {
      loadLatest: () => Promise.resolve(null),
      saveLatest: () => Promise.reject(new Error('quota exhausted')),
      remove: () => Promise.resolve(),
    };
    const session = new AelionSession();
    await session.loadProject(project());
    const persistence = await ProjectPersistenceController.attach(session, failingStore, {
      debounceMs: 60_000,
      onError: error => errors.push(error),
    });
    await expect(persistence.flush()).rejects.toThrow('quota exhausted');
    expect(errors).toHaveLength(1);
    await expect(persistence.dispose()).rejects.toThrow('quota exhausted');
    await session.dispose();

    const corrupted: ProjectRevisionStore = {
      loadLatest: () =>
        Promise.resolve({
          version: PROJECT_REVISION_RECORD_VERSION,
          projectId: 'persistent_project',
          generation: 1,
          sourceRevision: '0',
          savedAtEpochMs: 0,
          canonicalProject: JSON.stringify(project()),
          contentHash: 'sha256:corrupted',
        }),
      saveLatest: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    };
    const target = new AelionSession();
    await expect(restoreLatestProject(target, corrupted, 'persistent_project')).rejects.toThrow(
      'content-hash',
    );
    expect(target.state).toBe('empty');
    await target.dispose();
  });
});
