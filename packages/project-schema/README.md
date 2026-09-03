# `@aelionsdk/project-schema`

Project v2 types, immutable v1.0/v1.2/v2.0 schema identities, bounded admission,
validation, migration and canonical serialization for AelionSDK.

## Install

```bash
npm install @aelionsdk/project-schema
```

`latest` currently resolves to `2.0.0`. Use this package in importers,
services and Project tooling that must validate data without creating a browser
Session.

## Public surface

- Project v2 TypeScript types and item narrowing helpers;
- bounded plain-JSON admission;
- `ProjectValidator` and stable diagnostics;
- `migrateProjectToCurrent` for ownership-isolated v1.0/v1.2 upgrades;
- canonical clone and serialization helpers.

Treat every file or network Project as untrusted input. Run admission before
schema and semantic validation; never invoke accessors or iterators on
untrusted values.

See the [Project Schema reference](https://foyonaczy.github.io/AelionSDK/reference/project-schema/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/project-schema/overview/).
Licensed under MIT.
