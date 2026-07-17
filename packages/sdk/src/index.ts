import { AelionSession } from './session.js';
import type { AelionApi } from './types.js';

export * from './runtime-material-registry.js';
export * from './media-provider.js';
export * from './production-media-provider.js';
export * from './project-builder.js';
export * from './preview-controller.js';
export * from './default-schemas.js';
export * from './session.js';
export * from './types.js';

export const Aelion: AelionApi = {
  createSession: options => Promise.resolve(new AelionSession(options)),
};
