---
title: Create and install a Material
description: Build, analyze, package, verify, and authorize a declarative transition.
---

## Four core objects

- `MaterialDefinition` describes identity, kind, ports, parameters, resources, and execution.
- `MaterialGraph` is the typed declarative visual graph.
- `MaterialPackage` is the deterministic manifest plus payload.
- `MaterialInstance` is Project data that binds a definition to parameter/resource/input values.

## Create a Cross Dissolve

Use `materialGraph()` to declare typed input ports and a `mix` path controlled by transition
progress, then `materialDefinition()` to expose the transition contract and parameter defaults.
Graph validation checks node IDs, versions, bindings, types, cycles, outputs, and static budgets.

## Package

`packMaterialPackage()` produces canonical manifest identity, sorted payload entries, byte sizes,
and cryptographic integrity. The `aelion-material` CLI can scaffold, validate, generate types,
analyze, run golden tests, and create deterministic packages.

## Install and verify

Before installation, verify protocol/version ranges, canonical manifest, expected integrity,
payload hashes and sizes, optional publisher signature, and migration chain. Store packages by
exact identity; do not substitute a different version behind an existing instance.

## Material Lab

Use `MaterialLabSession` to inspect graph topology, inferred types, pass/texture budgets, backend
availability, diagnostics, and golden output before the Material enters a product catalog.

## Project and Session

Register trusted packages in the runtime registry, add a Material instance to the Project through
the builder/Composition API, bind it to its owner, then load the Project. The Session revalidates
identity, parameters, resources, ports, permissions, and an executable backend.

## Choose the kind

Filter transforms one visual input. Effect is owned by a host item. Transition combines two
ordered visual inputs over an edit interval. Generator produces visual content without host media.

## Trusted Shader and WASM

Declarative Core Nodes are the default. Custom Shader/WASM requires a trusted package, valid
signature/integrity, publisher allowlist, explicit host permission, sandbox/budget policy, and a
compatible offline implementation. A signature alone is not execution authorization.

See [Material Protocol v1](/AelionSDK/reference/material-protocol-v1/) for the complete contract.
