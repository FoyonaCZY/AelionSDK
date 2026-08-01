# `@aelionsdk/project-schema`

Project v1 types, bounded admission, validation and canonical serialization for
AelionSDK.

## Install

```bash
npm install @aelionsdk/project-schema@next
```

`next` currently resolves to `1.2.0-rc.1`. Use this package in importers,
services and Project tooling that must validate data without creating a browser
Session.

## Public surface

- Project v1 TypeScript types;
- bounded plain-JSON admission;
- `ProjectValidator` and stable diagnostics;
- canonical clone and serialization helpers.

Treat every file or network Project as untrusted input. Run admission before
schema and semantic validation; never invoke accessors or iterators on
untrusted values.

See the [Project Schema reference](https://foyonaczy.github.io/AelionSDK/reference/project-schema/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/project-schema/overview/).
Licensed under MIT.
