---
title: Material Protocol v1 specification
description: Material packages, definitions, graphs, instances, execution limits, security, and compatibility.
---

This is the normative overview for Material tooling, catalogs, runtimes, and render services.
Schema and exported TypeScript definitions remain authoritative for field-level validation.

## 1. Model

A Material is immutable reusable visual behavior. A package contains one manifest and declared
payload files. A definition describes one Filter, Effect, Transition, or Generator. A Project stores
instances that reference an exact definition identity and bind parameters, resources, and host
inputs. The runtime resolves an instance to an installed package and executable backend.

### Definition and instance

A Definition is author/catalog data: identity, display metadata, kind, ports, parameter/resource
schema, execution contract, graph or trusted implementations. An Instance is user Project data:
exact package/definition reference plus values and bindings. Instances never embed executable
payload.

### Material versus plugin

A declarative Material cannot call arbitrary host APIs. Trusted Shader/WASM implementations are
still constrained rendering implementations, not general UI or application plugins.

### Out of scope

The protocol does not define marketplace payment, account policy, collaborative editing, UI layout,
asset licensing, or arbitrary network/service APIs.

## 2. Kinds

- **Filter** transforms one visual input.
- **Effect** is owned by a host item and transforms its visual result.
- **Transition** combines ordered `from` and `to` visual inputs over normalized progress.
- **Generator** produces visual output without host media.

A Transition has one visual result, explicit input roles, a valid duration/range, deterministic
boundary behavior, and progress defined by the host interval. Effects cannot change Project
topology. Generators declare their canvas/time dependencies.

## 3. Two authoring levels

### Declarative Graph

The default is a typed, acyclic graph using the versioned Aelion Visual Core Node Set. The compiler
validates node IDs/versions, input/output types, bindings, result type, static cost, and backend
availability before execution.

### Trusted programmable implementation

Shader or WASM is allowed only when package integrity/signature, publisher trust, explicit host
permission, implementation restrictions, execution budgets, and offline parity all pass. It is not
a fallback for an invalid graph.

## 4. Material Package

```text
package-root/
  material.json
  definitions/
  graphs/
  resources/
  shaders/
  wasm/
  locales/
```

Paths are normalized relative POSIX paths. Absolute paths, traversal, ambiguous Unicode/case
collisions, undeclared files, symlinks, and executable surprises are rejected. Deterministic
packing sorts entries and fixes canonical metadata.

The manifest declares package ID/version, protocol and engine ranges, publisher/signature metadata,
definition and payload entries, content type, byte size, and cryptographic hash. Package integrity
is computed from canonical manifest identity and declared payload identities. Verification checks
the caller's expected integrity as well as every payload.

## 5. Material Definition

A definition contains stable ID/version, package identity, display metadata/localization, kind,
scope, ports, parameter/resource schemas, execution contract, graph/implementation references,
capability requirements, and migration information.

Display metadata is non-semantic. Scope declares legal hosts/ownership and does not grant runtime
permissions.

## 6. Ports and host bindings

Ports have stable IDs, direction, typed value kind, required/optional state, and semantic role.
Filter/Effect require their declared host visual input; Transition requires ordered `from`/`to`
inputs and progress; Generator does not bind host media unless a definition explicitly declares an
allowed auxiliary input. Project bindings refer only to legal host inputs in the same execution
scope.

## 7. Parameters

Supported parameter schemas are versioned typed scalar/vector/color/enum/boolean and other declared
protocol values. Each parameter has ID, type, default, optional UI metadata, and hard validation
constraints. Numeric minimum/maximum, step, units, color/alpha interpretation, animation policy,
and enum values must be explicit where applicable.

Defaults and instance values must canonicalize to the declared type. Values outside hard ranges are
rejected; UI hints never relax execution constraints.

## 8. Resources

A bundled resource is an immutable declared payload with content type, size, hash, and semantic
role. A resource slot describes the type and constraints an Instance may bind. Hosts validate
identity, origin/authorization, dimensions/format, byte budget, and decode policy before use.

Resources cannot introduce undeclared code or ambient network access. URLs and credentials are not
persisted as trusted package identity.

## 9. Material Graph

A graph declares graph/schema and Core Node Set versions, typed host/parameter/resource/system
inputs, unique nodes, bindings, and one visual-frame result.

Bindings may reference a literal, parameter, host port, system value, resource through an explicit
typed node, or another node output. Every required node input is bound exactly once; unknown inputs
are errors. Graphs are directed acyclic graphs unless a versioned feedback construct explicitly
defines bounded state.

The 1.0 Core Node Set covers typed math, vectors/matrices, UV/pixel transforms, color and alpha,
sampling, masks, blend/composite, time/progress, and declared deterministic utility nodes. Exact
formulas are in [Core Node Math 1.0.0](/AelionSDK/reference/core-node-math-v1/).

Hosts enforce limits for node count, graph depth, passes, texture samples, intermediate surfaces,
dimensions, resources, and compilation/execution time. Multipass graphs declare pass order and
surface formats. Unbounded feedback is forbidden.

## 10. Execution contract

The definition declares working color space, transfer function expectations, alpha form, UV origin
and normalization, pixel-center convention, sampling/filter/boundary behavior, output dimensions,
time/progress inputs, precision, and deterministic requirements.

Parameter-to-uniform layout is compiler-owned and versioned; packages must not assume
implementation-dependent packing unless the trusted implementation contract declares it.

Preview and export share semantics. Preview may choose a lower declared quality/performance tier,
but cannot change time, graph topology, color/alpha interpretation, or parameter meaning.
Performance hints are non-semantic.

## 11. Implementations and backends

The runtime selects only an implementation whose backend, protocol/node versions, color contract,
capabilities, permissions, and quality tier satisfy the request. Declarative graphs may compile to
WebGL2/WebGPU/offline backends.

Trusted shaders cannot access undeclared textures, buffers, storage, network, or host state. WASM
uses bounded memory/imports and cannot receive ambient browser capabilities. Custom node plugins
require a separately versioned, trusted host extension contract and are not portable Core Nodes.

## 12. Project Material Instance

An Instance contains ID, exact package/definition/integrity reference, owner, enabled state,
parameter values/animation, resource bindings, and host input bindings allowed by the definition.
Content-item instances follow the same identity model as effects/transitions.

Save/load preserves exact identity. If the package is missing, load fails or the product enters an
explicit unresolved-material workflow; it must not silently substitute latest. Version upgrades run
a deterministic contiguous migration chain, validate every output, and record the new identity.

## 13. Authoring SDK

The SDK provides typed definition and graph builders, package creation, validation, generated
parameter types, Material Lab analysis, golden testing, signing/trust helpers, migrations, and CLI
commands for scaffold, validate, pack, inspect, preview report, and golden evidence.

Authoring APIs layer from typed Core Nodes to definitions/packages; advanced trusted implementation
APIs require explicit opt-in.

## 14. Registry and installation

The registry installs verified packages by exact package/version/integrity, indexes definitions,
resolves Instance references, reports capabilities, performs migrations, and supplies immutable
payload to compilers/runtimes. It does not decide product marketplace policy.

Installation policy includes package size/count, allowed protocol/engine ranges, trusted
publishers, allowed kinds/permissions, resource and graph budgets, and replacement/removal rules.
Cache keys include all identities that affect output: package integrity, definition, protocol/node
set, backend/compiler version, execution contract, and relevant static parameters/resources.

## 15. Testing and certification

Required dimensions include schema/package/integrity, graph types and budgets, parameter/resource
boundaries, backend compilation, deterministic frames, preview/export parity, cancellation,
cleanup, migration, trust/permission denial, and malformed/adversarial input.

Kind-specific tests cover transition endpoints/progress, effect/filter host behavior, and generator
time/canvas behavior. Goldens declare environment and tolerance. Performance tiers report measured
cost but do not alter semantics.

A publish gate requires deterministic package bytes, passing validation/goldens, complete metadata
and docs, protocol/engine compatibility, trust identity, license/resource review, and a clean
install/execute/export test.

## 16. Errors

Material failures use stable `MATERIAL_*` diagnostics for protocol, package, integrity, missing
identity, definition, graph/type/binding, budgets, instance values/resources, backend, trust,
signature/publisher, permissions, migration, and execution admission. See
[Diagnostic codes](/AelionSDK/reference/diagnostic-codes/).

## 17. Security model

Declarative does not mean unlimited: hostile graphs can consume compile time, textures, passes,
memory, or pathological numeric ranges. Validate before allocation and enforce budgets again at
runtime.

Threats include path traversal, hash confusion, package bombs, graph bombs, shader/WASM escape,
resource exfiltration, publisher compromise/revocation, nondeterministic migrations, and
preview/export substitution. Permission denial is fail-closed.

| Capability             | Declarative graph        | Trusted Shader/WASM               |
| ---------------------- | ------------------------ | --------------------------------- |
| Host visual inputs     | declared ports only      | declared ports only               |
| Bundled resources      | declared and budgeted    | declared and budgeted             |
| Network                | denied by default        | explicit host policy only         |
| Arbitrary DOM/host API | never                    | never                             |
| Custom executable code | no                       | trusted restricted implementation |
| Offline export         | required compatible path | required compatible path          |

## 18. Status and compatibility

Protocol v1 and Core Node Set versions are independent, explicit identities. A host accepts only
declared compatible ranges and must reject unknown required fields, node versions, permissions, or
semantic contracts. Additive optional metadata may be ignored only where the schema says it is
non-semantic.

Breaking semantic changes require a new protocol/node-set version and an explicit migration path.
Package semver never overrides exact integrity or Project instance identity.
