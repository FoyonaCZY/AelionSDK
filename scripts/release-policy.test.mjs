import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReleaseVersion, releaseChannelForVersion } from './release-policy.mjs';

test('stable versions publish to latest as full GitHub releases', () => {
  assert.deepEqual(releaseChannelForVersion('1.0.0'), {
    version: '1.0.0',
    prerelease: false,
    npmDistTag: 'latest',
    githubReleaseKind: 'release',
  });
});

test('prerelease versions publish to next as GitHub prereleases', () => {
  assert.deepEqual(releaseChannelForVersion('0.2.0-rc.2'), {
    version: '0.2.0-rc.2',
    prerelease: true,
    npmDistTag: 'next',
    githubReleaseKind: 'prerelease',
  });
  assert.deepEqual(parseReleaseVersion('0.1.0-beta.1').prerelease, ['beta', '1']);
});

test('release versions reject non-canonical or unsafe forms', () => {
  for (const version of ['v1.0.0', '01.0.0', '1.0', '1.0.0+build.1', '1.0.0-rc.01', '1.0.0-', '']) {
    assert.throws(() => parseReleaseVersion(version), /Release version|zero-padded/u);
  }
});
