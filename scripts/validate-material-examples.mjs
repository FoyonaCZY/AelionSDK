#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplesRoot = join(root, 'examples', 'materials');
const projectExamplePath = join(root, 'examples', 'aelion-project-v1.example.json');
const errors = [];
const packageRegistry = new Map();

const fail = (path, message) => errors.push(`${path}: ${message}`);
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

function isSafeRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\\')) return false;
  const normalized = normalize(path);
  return !normalized.startsWith(`..${sep}`) && normalized !== '..' && !normalized.startsWith(sep);
}

function uniqueIds(values, path) {
  const seen = new Set();
  for (const value of values) {
    if (!value || typeof value.id !== 'string') {
      fail(path, 'entry is missing a string id');
      continue;
    }
    if (seen.has(value.id)) fail(path, `duplicate id ${value.id}`);
    seen.add(value.id);
  }
  return seen;
}

async function validatePackage(packageDir) {
  const displayDir = relative(root, packageDir);
  const manifestPath = join(packageDir, 'manifest.json');
  const manifest = await readJson(manifestPath);
  const canonicalManifest = canonicalize(manifest);
  const packageIntegrity = `sha256:${createHash('sha256').update(canonicalManifest).digest('hex')}`;

  if (manifest.protocolVersion !== '1.0.0') fail(displayDir, 'unsupported protocolVersion');
  const materialIds = uniqueIds(manifest.materials ?? [], `${displayDir}/manifest.materials`);
  const filePaths = new Set();

  for (const entry of manifest.files ?? []) {
    if (!isSafeRelativePath(entry.path)) {
      fail(displayDir, `unsafe file path ${entry.path}`);
      continue;
    }
    if (filePaths.has(entry.path)) fail(displayDir, `duplicate file path ${entry.path}`);
    filePaths.add(entry.path);
    const absolute = resolve(packageDir, entry.path);
    if (!absolute.startsWith(`${packageDir}${sep}`)) {
      fail(displayDir, `file escapes package ${entry.path}`);
      continue;
    }
    const bytes = await readFile(absolute);
    const size = (await stat(absolute)).size;
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (entry.bytes !== size) fail(displayDir, `${entry.path} byte count mismatch`);
    if (entry.sha256 !== hash) fail(displayDir, `${entry.path} sha256 mismatch`);
  }

  for (const materialEntry of manifest.materials ?? []) {
    if (!isSafeRelativePath(materialEntry.definition)) {
      fail(displayDir, `unsafe definition path ${materialEntry.definition}`);
      continue;
    }
    if (!filePaths.has(materialEntry.definition)) {
      fail(displayDir, `definition is absent from files: ${materialEntry.definition}`);
    }

    const definitionPath = resolve(packageDir, materialEntry.definition);
    const definition = await readJson(definitionPath);
    if (definition.id !== materialEntry.id) fail(displayDir, `definition id mismatch for ${materialEntry.id}`);
    if (definition.kind !== materialEntry.kind) fail(displayDir, `definition kind mismatch for ${materialEntry.id}`);
    validateDefinition(definition, displayDir);

    for (const implementation of definition.implementations ?? []) {
      if (implementation.type !== 'graph') continue;
      if (!filePaths.has(implementation.graph)) {
        fail(displayDir, `graph is absent from files: ${implementation.graph}`);
      }
      const graph = await readJson(resolve(packageDir, implementation.graph));
      validateGraph(graph, definition, displayDir);
    }
  }

  if (materialIds.size === 0) fail(displayDir, 'package has no materials');

  const key = `${manifest.package?.id}@${manifest.package?.version}`;
  if (packageRegistry.has(key)) fail(displayDir, `duplicate package identity ${key}`);
  packageRegistry.set(key, {
    integrity: packageIntegrity,
    materials: new Map((manifest.materials ?? []).map(entry => [entry.id, entry])),
    definitions: new Map(),
  });

  const registryEntry = packageRegistry.get(key);
  for (const materialEntry of manifest.materials ?? []) {
    registryEntry.definitions.set(
      materialEntry.id,
      await readJson(resolve(packageDir, materialEntry.definition)),
    );
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateValueAgainstParameter(value, parameter, path) {
  if (value && typeof value === 'object' && 'animation' in value) return;
  const numeric = ['integer', 'float', 'angle', 'duration'].includes(parameter.type);
  if (numeric && typeof value !== 'number') fail(path, `parameter ${parameter.id} must be numeric`);
  if (parameter.type === 'integer' && !Number.isSafeInteger(value)) fail(path, `parameter ${parameter.id} must be a safe integer`);
  if (parameter.type === 'boolean' && typeof value !== 'boolean') fail(path, `parameter ${parameter.id} must be boolean`);
  if ((parameter.type === 'enum' || parameter.type === 'string') && typeof value !== 'string') fail(path, `parameter ${parameter.id} must be a string`);
  if (parameter.type === 'enum' && !(parameter.values ?? []).includes(value)) fail(path, `parameter ${parameter.id} has an invalid enum value`);
  if (numeric && parameter.range?.min !== undefined && value < parameter.range.min) fail(path, `parameter ${parameter.id} is below min`);
  if (numeric && parameter.range?.max !== undefined && value > parameter.range.max) fail(path, `parameter ${parameter.id} is above max`);
}

async function validateProjectExample() {
  const project = await readJson(projectExamplePath);
  const displayPath = relative(root, projectExamplePath);
  const instances = project.materialInstances ?? {};

  for (const [id, instance] of Object.entries(instances)) {
    if (instance.id !== id) fail(displayPath, `materialInstances key/id mismatch for ${id}`);
    const ref = instance.definition ?? {};
    const pkg = packageRegistry.get(`${ref.packageId}@${ref.packageVersion}`);
    if (!pkg) {
      fail(displayPath, `instance ${id} references missing package ${ref.packageId}@${ref.packageVersion}`);
      continue;
    }
    if (pkg.integrity !== ref.packageIntegrity) fail(displayPath, `instance ${id} package integrity mismatch`);
    const definition = pkg.definitions.get(ref.materialId);
    if (!definition) {
      fail(displayPath, `instance ${id} references missing material ${ref.materialId}`);
      continue;
    }
    const parameterMap = new Map((definition.parameters ?? []).map(parameter => [parameter.id, parameter]));
    for (const [parameterId, value] of Object.entries(instance.parameters ?? {})) {
      const parameter = parameterMap.get(parameterId);
      if (!parameter) fail(displayPath, `instance ${id} has unknown parameter ${parameterId}`);
      else validateValueAgainstParameter(value, parameter, `${displayPath}/${id}`);
    }
    for (const parameter of definition.parameters ?? []) {
      if (!(parameter.id in (instance.parameters ?? {})) && parameter.default === undefined) {
        fail(displayPath, `instance ${id} is missing required parameter ${parameter.id}`);
      }
    }
  }

  const owners = new Map();
  const claim = (instanceId, owner, allowedKinds) => {
    const instance = instances[instanceId];
    if (!instance) {
      fail(displayPath, `${owner} references missing MaterialInstance ${instanceId}`);
      return;
    }
    if (owners.has(instanceId)) fail(displayPath, `${instanceId} is owned by both ${owners.get(instanceId)} and ${owner}`);
    owners.set(instanceId, owner);
    const ref = instance.definition;
    const definition = packageRegistry.get(`${ref.packageId}@${ref.packageVersion}`)?.definitions.get(ref.materialId);
    if (definition && !allowedKinds.includes(definition.kind)) {
      fail(displayPath, `${owner} cannot use ${definition.kind} Material ${instanceId}`);
    }
  };

  for (const sequence of Object.values(project.sequences ?? {})) {
    for (const id of sequence.materialInstanceIds ?? []) claim(id, `sequence ${sequence.id}`, ['visual-filter', 'visual-effect']);
  }
  for (const track of Object.values(project.tracks ?? {})) {
    for (const id of track.materialInstanceIds ?? []) claim(id, `track ${track.id}`, ['visual-filter', 'visual-effect']);
  }
  for (const item of Object.values(project.items ?? {})) {
    for (const id of item.materialInstanceIds ?? []) claim(id, `item ${item.id}`, ['visual-filter', 'visual-effect']);
    if (item.type === 'material-content') claim(item.materialInstanceId, `item ${item.id}`, ['visual-generator']);
  }
  for (const transition of Object.values(project.transitions ?? {})) {
    claim(transition.materialInstanceId, `transition ${transition.id}`, ['visual-transition']);
  }
  for (const id of Object.keys(instances)) {
    if (!owners.has(id)) fail(displayPath, `orphan MaterialInstance ${id}`);
  }
}

function validateDefinition(definition, path) {
  const ports = uniqueIds(definition.ports ?? [], `${path}/ports`);
  const parameters = uniqueIds(definition.parameters ?? [], `${path}/parameters`);
  uniqueIds(definition.bundledResources ?? [], `${path}/bundledResources`);
  uniqueIds(definition.resourceSlots ?? [], `${path}/resourceSlots`);

  const portById = new Map((definition.ports ?? []).map(port => [port.id, port]));
  const expectPort = (id, direction, type, role) => {
    const port = portById.get(id);
    if (!port || port.direction !== direction || port.type !== type || port.role !== role || !port.required) {
      fail(path, `${definition.kind} requires ${direction} port ${id}:${type}/${role}`);
    }
  };

  if (definition.kind === 'visual-filter') {
    expectPort('source', 'input', 'visual-frame', 'source');
    expectPort('result', 'output', 'visual-frame', 'result');
    if ((definition.execution?.spatialPadding?.mode ?? 'none') !== 'none') {
      fail(path, 'visual-filter cannot declare spatial padding');
    }
    if (definition.execution?.temporal?.stateful) fail(path, 'visual-filter cannot be stateful');
  } else if (definition.kind === 'visual-transition') {
    expectPort('from', 'input', 'visual-frame', 'from');
    expectPort('to', 'input', 'visual-frame', 'to');
    expectPort('result', 'output', 'visual-frame', 'result');
    if (!(definition.scopes ?? []).includes('transition')) fail(path, 'transition scope is required');
  } else if (definition.kind === 'visual-generator') {
    expectPort('result', 'output', 'visual-frame', 'result');
  } else if (definition.kind !== 'visual-effect') {
    fail(path, `unknown material kind ${definition.kind}`);
  }

  for (const parameter of definition.parameters ?? []) {
    if (parameter.animatable && parameter.affects !== 'uniform') {
      fail(path, `animatable parameter ${parameter.id} must affect uniform`);
    }
    if (parameter.type === 'enum' && !(parameter.values ?? []).includes(parameter.default)) {
      fail(path, `enum parameter ${parameter.id} default is not in values`);
    }
  }
  return { ports, parameters };
}

function validateGraph(graph, definition, path) {
  const nodes = graph.nodes ?? [];
  const nodeIds = uniqueIds(nodes, `${path}/graph.nodes`);
  const parameterIds = new Set((definition.parameters ?? []).map(value => value.id));
  const resourceIds = new Set([
    ...(definition.bundledResources ?? []).map(value => value.id),
    ...(definition.resourceSlots ?? []).map(value => value.id),
  ]);
  const inputPortIds = new Set(
    (definition.ports ?? []).filter(port => port.direction === 'input').map(port => port.id),
  );
  const edges = new Map(nodes.map(node => [node.id, new Set()]));

  for (const node of nodes) {
    for (const value of Object.values(node.inputs ?? {})) {
      if (value && typeof value === 'object' && 'node' in value) {
        if (!nodeIds.has(value.node)) fail(path, `node ${node.id} references missing node ${value.node}`);
        else edges.get(node.id).add(value.node);
      } else if (value && typeof value === 'object' && 'parameter' in value) {
        if (!parameterIds.has(value.parameter)) fail(path, `node ${node.id} references missing parameter ${value.parameter}`);
      } else if (value && typeof value === 'object' && 'resource' in value) {
        if (!resourceIds.has(value.resource)) fail(path, `node ${node.id} references missing resource ${value.resource}`);
      } else if (value && typeof value === 'object' && 'inputPort' in value) {
        if (!inputPortIds.has(value.inputPort)) fail(path, `node ${node.id} references missing input port ${value.inputPort}`);
      }
    }
  }

  for (const [outputId, output] of Object.entries(graph.outputs ?? {})) {
    if (!nodeIds.has(output.node)) fail(path, `output ${outputId} references missing node ${output.node}`);
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) {
      fail(path, `graph cycle includes ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of nodeIds) visit(id);

  const resultPort = (definition.ports ?? []).find(port => port.direction === 'output' && port.id === 'result');
  if (resultPort && !graph.outputs?.result) fail(path, 'graph does not bind required result output');
}

const packageNames = (await readdir(examplesRoot, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && entry.name !== 'authoring-sdk')
  .map(entry => entry.name)
  .sort();

for (const packageName of packageNames) {
  await validatePackage(join(examplesRoot, packageName));
}

await validateProjectExample();

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Validated ${packageNames.length} material packages and the project example successfully.`);
