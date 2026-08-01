import { AelionSession } from './session.js';
import type { AelionApi } from './types.js';

export * from './runtime-material-registry.js';
export * from './media-provider.js';
export * from './production-media-provider.js';
export * from './project-builder.js';
export * from './rate-envelope.js';
export * from './subtitle-io.js';
export * from './composition.js';
export * from './diagnostic-report.js';
export * from './migration.js';
export * from './migration-materials.js';
export * from './audio-controller.js';
export * from './audio-mastering.js';
export * from './persistence.js';
export * from './extension-host.js';
export * from './preview-controller.js';
export * from './default-schemas.js';
export * from './session.js';
export * from './types.js';

export const Aelion: AelionApi = {
  createSession: options => Promise.resolve(new AelionSession(options)),
};
