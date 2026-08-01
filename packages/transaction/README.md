# `@aelionsdk/transaction`

Atomic Project transactions, editing commands, inverses and bounded history for
AelionSDK.

## Install

```bash
npm install @aelionsdk/transaction@next
```

`next` currently resolves to `1.2.0-rc.1`. Product applications should edit
through an `@aelionsdk/sdk` Session; direct use is intended for custom hosts and
engine integrations.

## Public surface

- production timeline editing commands;
- atomic transaction execution and inverse generation;
- undo/redo history;
- affected ranges and change sets;
- interactive transaction lifecycle.

Submit edits through transactions instead of mutating Project snapshots.
Interactive drags should commit or cancel explicitly so they occupy one history
entry and do not leave partial state.

See the [transaction guide](https://foyonaczy.github.io/AelionSDK/concepts/transactions/)
and [API reference](https://foyonaczy.github.io/AelionSDK/api/aelionsdk/transaction/overview/).
Licensed under MIT.
