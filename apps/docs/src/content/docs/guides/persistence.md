---
title: Save, restore, and reconnect media
description: Persist Project JSON, reconnect local or remote media, autosave revisions, and migrate versions.
---

## Save Project JSON

Read a committed Session snapshot and persist its canonical Project plus the revision and your
application metadata. Project JSON contains stable IDs and timeline semantics, not runtime media
objects or credentials.

## Autosave

Subscribe to commits, debounce writes by revision, serialize in order, and never allow a slower
older write to replace a newer revision. Record terminal save failure and retry policy explicitly.

## Asset locators

Store only product-owned hints needed to ask for or recover a source: asset-library ID, OPFS key,
content hash, safe URL template, or local file name/size/modified metadata. Do not store bearer
tokens, `FileSystemHandle` assumptions, Blob URLs, or private paths in Project.

## Correct restore order

1. Parse and migrate application metadata.
2. Validate/migrate Project JSON under input budgets.
3. Resolve or ask for each required asset representation.
4. Register media in the provider.
5. Create and load the Session.
6. Attach preview/player and enable editing.

## Missing media

Keep the Project intact, report unresolved asset IDs, let the user locate replacements, probe and
verify compatibility, then register them. Do not silently bind a different-duration source.

## Schema and application extensions

Run explicit, deterministic, versioned migrations before load. Keep product-only state in an
application envelope keyed by Project ID/revision or in the Project extension field allowed by the
schema; never add arbitrary top-level fields.

## Close checks

Confirm or cancel active export, await the latest required save, stop incoming commands, dispose
runtime resources, and retain only durable data. See
[Project v2 field reference](/AelionSDK/reference/project-schema/).
