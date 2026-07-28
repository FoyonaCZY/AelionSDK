const SEMVER_CORE = '(0|[1-9]\\d*)';
const PRERELEASE_IDENTIFIER = '[0-9A-Za-z-]+';
const RELEASE_VERSION_PATTERN = new RegExp(
  `^${SEMVER_CORE}\\.${SEMVER_CORE}\\.${SEMVER_CORE}(?:-(${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*))?$`,
  'u',
);

export function parseReleaseVersion(version) {
  if (typeof version !== 'string') {
    throw new TypeError(`Release version must be a string, received ${typeof version}`);
  }

  const match = RELEASE_VERSION_PATTERN.exec(version);
  if (match === null) {
    throw new TypeError(`Release version is not publishable SemVer: ${version}`);
  }

  const prerelease = match[4];
  if (
    prerelease !== undefined &&
    prerelease
      .split('.')
      .some(
        identifier => /^\d+$/u.test(identifier) && identifier.length > 1 && identifier[0] === '0',
      )
  ) {
    throw new TypeError(`Release version has a zero-padded prerelease identifier: ${version}`);
  }

  return Object.freeze({
    version,
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: prerelease?.split('.') ?? [],
  });
}

export function releaseChannelForVersion(version) {
  const parsed = parseReleaseVersion(version);
  const isPrerelease = parsed.prerelease.length > 0;
  return Object.freeze({
    version,
    prerelease: isPrerelease,
    npmDistTag: isPrerelease ? 'next' : 'latest',
    githubReleaseKind: isPrerelease ? 'prerelease' : 'release',
  });
}
