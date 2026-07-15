import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import {
  materialDefinitionSchema,
  materialGraphSchema,
  materialPackageSchema,
} from './bundled-schemas.js';

const ajv = new Ajv2020({
  // Shape admission runs before these validators and rejects oversized input.
  // Stop at the first schema failure so invalid packages cannot amplify CPU or
  // retained error state by asking Ajv to enumerate every violation.
  allErrors: false,
  allowUnionTypes: true,
  strict: true,
  validateFormats: true,
});
addFormats(ajv);

const validateManifest = ajv.compile(materialPackageSchema);
const validateDefinition = ajv.compile(materialDefinitionSchema);
const validateGraph = ajv.compile(materialGraphSchema);

function pointer(error: ErrorObject): string {
  return error.instancePath === '' ? '/' : error.instancePath;
}

function assertSchema(value: unknown, name: string, validator: ValidateFunction): void {
  if (validator(value)) return;
  const first = validator.errors?.[0];
  const message = first?.message ?? `does not conform to the ${name} schema`;
  const path = first === undefined ? '/' : pointer(first);
  throw new TypeError(`MATERIAL_PACKAGE_INVALID: ${name} ${path} ${message}`);
}

export function assertMaterialManifestSchema(value: unknown): void {
  assertSchema(value, 'manifest', validateManifest);
}

export function assertMaterialDefinitionSchema(value: unknown): void {
  assertSchema(value, 'definition', validateDefinition);
}

export function assertMaterialGraphSchema(value: unknown): void {
  assertSchema(value, 'graph', validateGraph);
}
