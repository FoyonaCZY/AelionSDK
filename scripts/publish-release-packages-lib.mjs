import { setTimeout as wait } from 'node:timers/promises';

export const REGISTRY_VERIFY_INTERVAL_MS = 10_000;
export const REGISTRY_VERIFY_TIMEOUT_MS = 10 * 60_000;

function errorOutput(error) {
  return `${error?.message ?? ''}\n${error?.stdout ?? ''}\n${error?.stderr ?? ''}`;
}

export function publicationWasAlreadyAccepted(error) {
  const output = errorOutput(error);
  return (
    /\bEPUBLISHCONFLICT\b/u.test(output) ||
    /cannot publish over (?:the )?previously published versions?/iu.test(output) ||
    /cannot modify (?:a )?pre-existing version/iu.test(output)
  );
}

export async function publishWithRegistryConsistency({
  entries,
  publishedIntegrity,
  publish,
  intervalMs = REGISTRY_VERIFY_INTERVAL_MS,
  timeoutMs = REGISTRY_VERIFY_TIMEOUT_MS,
  waitFor = wait,
  log = message => process.stdout.write(`${message}\n`),
}) {
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    typeof publishedIntegrity !== 'function' ||
    typeof publish !== 'function' ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < intervalMs
  ) {
    throw new Error('Registry publication options are invalid');
  }

  const pending = [];
  for (const entry of entries) {
    const existing = await publishedIntegrity(entry);
    if (existing === undefined) {
      pending.push(entry);
      continue;
    }
    if (existing !== entry.integrity) {
      throw new Error(`${entry.name}@${entry.version} already exists with different bytes`);
    }
    log(`Verified existing ${entry.name}@${entry.version}`);
  }

  for (const entry of pending) {
    try {
      await publish(entry);
      log(`Publish accepted for ${entry.name}@${entry.version}`);
    } catch (error) {
      if (!publicationWasAlreadyAccepted(error)) throw error;
      log(`Publish was already accepted for ${entry.name}@${entry.version}`);
    }
  }

  let unresolved = pending;
  const attempts = Math.ceil(timeoutMs / intervalMs) + 1;
  for (let attempt = 0; attempt < attempts && unresolved.length > 0; attempt += 1) {
    const states = await Promise.all(
      unresolved.map(async entry => ({
        entry,
        integrity: await publishedIntegrity(entry),
      })),
    );
    const next = [];
    for (const { entry, integrity } of states) {
      if (integrity === undefined) {
        next.push(entry);
        continue;
      }
      if (integrity !== entry.integrity) {
        throw new Error(`${entry.name}@${entry.version} registry integrity differs after publish`);
      }
      log(`Verified published ${entry.name}@${entry.version}`);
    }
    unresolved = next;
    if (unresolved.length === 0) break;
    if (attempt === attempts - 1) {
      throw new Error(
        `Timed out waiting for registry consistency: ${unresolved
          .map(entry => `${entry.name}@${entry.version}`)
          .join(', ')}`,
      );
    }
    log(
      `Waiting for registry consistency (${String(unresolved.length)} package${
        unresolved.length === 1 ? '' : 's'
      } remaining)`,
    );
    await waitFor(intervalMs);
  }
}
