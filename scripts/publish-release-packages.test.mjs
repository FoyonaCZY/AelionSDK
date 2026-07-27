import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicationWasAlreadyAccepted,
  publishWithRegistryConsistency,
} from './publish-release-packages-lib.mjs';

const core = {
  name: '@aelionsdk/core',
  version: '0.1.0-beta.1',
  integrity: 'sha512-core',
};
const capability = {
  name: '@aelionsdk/capability',
  version: '0.1.0-beta.1',
  integrity: 'sha512-capability',
};
const compiler = {
  name: '@aelionsdk/material-compiler',
  version: '0.1.0-beta.1',
  integrity: 'sha512-compiler',
};

test('publisher submits every missing package before waiting for registry consistency', async () => {
  const lookups = new Map([
    [core.name, [core.integrity]],
    [capability.name, [undefined, undefined, capability.integrity]],
    [compiler.name, [undefined, undefined, undefined, compiler.integrity]],
  ]);
  const published = [];
  const events = [];
  let waits = 0;

  await publishWithRegistryConsistency({
    entries: [core, capability, compiler],
    publishedIntegrity: entry => Promise.resolve(lookups.get(entry.name).shift()),
    publish: entry => {
      published.push(entry.name);
      if (entry === compiler) {
        return Promise.reject(
          Object.assign(new Error('403 Forbidden'), {
            stderr: 'You cannot publish over the previously published versions',
          }),
        );
      }
      return Promise.resolve();
    },
    intervalMs: 1,
    timeoutMs: 4,
    waitFor: () => {
      waits += 1;
      events.push(`wait:${published.join(',')}`);
      return Promise.resolve();
    },
    log: message => events.push(message),
  });

  assert.deepEqual(published, [capability.name, compiler.name]);
  assert.equal(waits, 2);
  assert.ok(events.includes(`wait:${capability.name},${compiler.name}`));
  assert.ok(events.includes(`Verified published ${compiler.name}@${compiler.version}`));
});

test('publisher fails closed when a visible version has different bytes', async () => {
  let publishCalled = false;
  await assert.rejects(
    publishWithRegistryConsistency({
      entries: [core],
      publishedIntegrity: () => Promise.resolve('sha512-other'),
      publish: () => {
        publishCalled = true;
        return Promise.resolve();
      },
      intervalMs: 1,
      timeoutMs: 1,
      log: () => undefined,
    }),
    /already exists with different bytes/u,
  );
  assert.equal(publishCalled, false);
});

test('publisher times out when npm never exposes an accepted version', async () => {
  await assert.rejects(
    publishWithRegistryConsistency({
      entries: [capability],
      publishedIntegrity: () => Promise.resolve(undefined),
      publish: () => Promise.resolve(),
      intervalMs: 1,
      timeoutMs: 2,
      waitFor: () => Promise.resolve(),
      log: () => undefined,
    }),
    /Timed out waiting for registry consistency/u,
  );
});

test('only immutable-version conflicts are treated as an accepted publish', () => {
  assert.equal(
    publicationWasAlreadyAccepted(
      Object.assign(new Error('publish failed'), {
        stderr: 'npm error code EPUBLISHCONFLICT',
      }),
    ),
    true,
  );
  assert.equal(
    publicationWasAlreadyAccepted(
      Object.assign(new Error('403 Forbidden'), {
        stderr: 'Token does not have permission to publish this package',
      }),
    ),
    false,
  );
});
