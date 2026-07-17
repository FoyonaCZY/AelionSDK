import type { JsonObject, JsonValue } from '@aelion/core';
import { AelionError } from '@aelion/core';
import {
  canonicalClone,
  type AelionProject,
  type CollectionName,
  type EntityId,
} from '@aelion/project-schema';

import { collectAffectedRanges } from './affected-ranges.js';
import { applyOperations } from './operations.js';
import type {
  AtomicOperation,
  ChangeSet,
  EditOptions,
  ProjectChangeListener,
  ProjectValidation,
  TransactionCommit,
  TransactionEngineOptions,
} from './types.js';

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(entry => deepFreeze(entry));
  }
  return value;
}

function transactionError(code: string, message: string): AelionError {
  return new AelionError([
    {
      code,
      severity: 'error',
      message,
      recoverable: true,
    },
  ]);
}

function createDraft(
  project: AelionProject,
  operations: readonly AtomicOperation[],
): AelionProject {
  const draft = { ...project } as AelionProject;
  const collections = new Set(operations.map(operation => operation.collection));
  for (const collection of collections) {
    const source = project[collection] as Record<string, JsonObject>;
    const cloned = { ...source };
    const entityIds = new Set(
      operations
        .filter(operation => operation.collection === collection)
        .map(operation => operation.id),
    );
    for (const id of entityIds) {
      const entity = source[id];
      if (entity !== undefined) cloned[id] = canonicalClone(entity);
    }
    Reflect.set(draft, collection, cloned);
  }
  return draft;
}

let changeSetSequence = 0;

export const TRANSACTION_MAX_OPERATIONS = 16_384;

function createChangeSetId(): string {
  changeSetSequence += 1;
  return `chg_${Date.now().toString(36)}_${changeSetSequence.toString(36)}`;
}

export class TransactionBuilder {
  readonly #operations: AtomicOperation[] = [];

  public get operations(): readonly AtomicOperation[] {
    return this.#operations;
  }

  /**
   * Appends an already validated operation sequence to this transaction.
   *
   * This is primarily used by history/replay adapters. Operations are cloned so
   * callers cannot mutate a transaction after it has been committed.
   */
  public appendOperations(operations: readonly AtomicOperation[]): void {
    if (this.#operations.length + operations.length > TRANSACTION_MAX_OPERATIONS) {
      throw transactionError(
        'TRANSACTION_OPERATION_LIMIT_EXCEEDED',
        `A transaction cannot contain more than ${TRANSACTION_MAX_OPERATIONS.toString()} operations`,
      );
    }
    this.#operations.push(...operations.map(operation => structuredClone(operation)));
  }

  public createEntity(collection: CollectionName, id: EntityId, value: JsonObject): void {
    this.#push({ op: 'createEntity', collection, id, value });
  }

  public deleteEntity(collection: CollectionName, id: EntityId): void {
    this.#push({ op: 'deleteEntity', collection, id });
  }

  public setField(
    collection: CollectionName,
    id: EntityId,
    path: readonly string[],
    value: JsonValue,
  ): void {
    this.#push({ op: 'setField', collection, id, path, value });
  }

  public removeField(collection: CollectionName, id: EntityId, path: readonly string[]): void {
    this.#push({ op: 'removeField', collection, id, path });
  }

  public listInsert(
    collection: CollectionName,
    id: EntityId,
    path: readonly string[],
    valueId: EntityId,
    beforeId?: EntityId,
  ): void {
    this.#push({
      op: 'listInsert',
      collection,
      id,
      path,
      valueId,
      ...(beforeId === undefined ? {} : { beforeId }),
    });
  }

  public listRemove(
    collection: CollectionName,
    id: EntityId,
    path: readonly string[],
    valueId: EntityId,
  ): void {
    this.#push({ op: 'listRemove', collection, id, path, valueId });
  }

  public listMove(
    collection: CollectionName,
    id: EntityId,
    path: readonly string[],
    valueId: EntityId,
    beforeId?: EntityId,
  ): void {
    this.#push({
      op: 'listMove',
      collection,
      id,
      path,
      valueId,
      ...(beforeId === undefined ? {} : { beforeId }),
    });
  }

  #push(operation: AtomicOperation): void {
    if (this.#operations.length >= TRANSACTION_MAX_OPERATIONS) {
      throw transactionError(
        'TRANSACTION_OPERATION_LIMIT_EXCEEDED',
        `A transaction cannot contain more than ${TRANSACTION_MAX_OPERATIONS.toString()} operations`,
      );
    }
    this.#operations.push(operation);
  }
}

export class TransactionEngine {
  readonly #validate: ProjectValidation;
  readonly #prepareCommit: TransactionEngineOptions['prepareCommit'];
  readonly #listeners = new Set<ProjectChangeListener>();
  #project: AelionProject;
  #revision = 0n;
  #committing = false;
  #reentrantAttempted = false;

  public constructor(
    project: AelionProject,
    validate: ProjectValidation,
    options: TransactionEngineOptions = {},
  ) {
    const cloned = canonicalClone(project);
    const result = validate(cloned);
    if (!result.ok) throw new AelionError(result.diagnostics);
    this.#project = deepFreeze(cloned) as AelionProject;
    this.#validate = validate;
    this.#prepareCommit = options.prepareCommit;
  }

  public get revision(): bigint {
    return this.#revision;
  }

  public getSnapshot(): Readonly<AelionProject> {
    return this.#project;
  }

  public subscribe(listener: ProjectChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public edit(
    options: EditOptions,
    callback: (transaction: TransactionBuilder) => void,
  ): TransactionCommit {
    if (this.#committing) {
      this.#reentrantAttempted = true;
      throw transactionError(
        'TRANSACTION_REENTRANT',
        'A transaction cannot start while another transaction is being committed',
      );
    }
    this.#committing = true;
    this.#reentrantAttempted = false;
    try {
      const baseRevision = options.baseRevision ?? this.#revision;
      if (baseRevision !== this.#revision) {
        throw transactionError(
          'REVISION_CONFLICT',
          `Expected revision ${baseRevision}, current revision is ${this.#revision}`,
        );
      }

      const before = this.#project;
      const transaction = new TransactionBuilder();
      callback(transaction);
      this.#assertNoReentrantAttempt();
      if (transaction.operations.length === 0) {
        throw transactionError('TRANSACTION_EMPTY', 'A transaction must contain an operation');
      }

      const draft = createDraft(before, transaction.operations);
      const inverse = applyOperations(draft, transaction.operations);
      const validation = this.#validate(draft);
      if (!validation.ok) throw new AelionError(validation.diagnostics);
      this.#assertNoReentrantAttempt();
      this.#assertBaseUnchanged(baseRevision, before);

      const committedRevision = baseRevision + 1n;
      const affectedEntityIds = [
        ...new Set(transaction.operations.map(operation => operation.id)),
      ].sort();
      const changeSet: ChangeSet = {
        id: createChangeSetId(),
        baseRevision,
        committedRevision,
        ...(options.label === undefined ? {} : { label: options.label }),
        operations: transaction.operations.map(operation => structuredClone(operation)),
        affectedEntityIds,
        affectedRanges: collectAffectedRanges(before, draft, transaction.operations),
      };
      const snapshot = deepFreeze(draft) as AelionProject;
      const commit: TransactionCommit = {
        revision: committedRevision,
        snapshot,
        changeSet,
        inverse,
      };

      const prepared = this.#prepareCommit?.(commit);
      this.#assertNoReentrantAttempt();
      this.#assertBaseUnchanged(baseRevision, before);
      prepared?.publish();
      this.#assertNoReentrantAttempt();
      this.#assertBaseUnchanged(baseRevision, before);

      this.#project = snapshot;
      this.#revision = committedRevision;
      // Change listeners are post-commit observers. One observer must not make
      // a successful commit appear to fail or extend this dispatch by adding
      // listeners while it is in progress.
      for (const listener of [...this.#listeners]) {
        try {
          listener(commit);
        } catch {
          // Observer failures do not roll back an already-published commit.
        }
      }
      return commit;
    } finally {
      this.#committing = false;
      this.#reentrantAttempted = false;
    }
  }

  public applyChangeSet(changeSet: ChangeSet): TransactionCommit {
    return this.edit(
      {
        ...(changeSet.label === undefined ? {} : { label: changeSet.label }),
        baseRevision: changeSet.baseRevision,
      },
      transaction => {
        transaction.appendOperations(changeSet.operations);
      },
    );
  }

  #assertBaseUnchanged(baseRevision: bigint, before: AelionProject): void {
    if (this.#revision === baseRevision && this.#project === before) return;
    throw transactionError(
      'REVISION_CONFLICT',
      `Expected revision ${baseRevision}, current revision is ${this.#revision}`,
    );
  }

  #assertNoReentrantAttempt(): void {
    if (!this.#reentrantAttempted) return;
    throw transactionError(
      'TRANSACTION_REENTRANT',
      'A nested transaction was attempted while this transaction was being committed',
    );
  }
}
