import * as aelion from '../packages/sdk/src/index.js';

// These two aliases are intentionally supplied only by benchmark-competitors.mjs.
// @ts-expect-error optional competitor dependency
import * as diffusion from '@benchmark/diffusion';
// @ts-expect-error optional competitor dependency
import * as webav from '@benchmark/webav';

import { runSameMachineCompetitorBenchmark } from './competitor-benchmark-browser.js';

Object.assign(globalThis, {
  __runAelionCompetitorBenchmark: () =>
    runSameMachineCompetitorBenchmark({ aelion, webav, diffusion }),
});
