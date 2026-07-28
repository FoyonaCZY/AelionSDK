---
title: Revision persistence and isolated extensions
description: Recover ordered Project snapshots and run extension logic through bounded Worker RPC.
---

## Revision-driven persistence

Persist snapshots in revision order, include schema/application versions and a content identity,
and make replacement atomic. Recovery selects the newest valid snapshot, runs deterministic
migrations, reconnects media, and loads it through the normal Project validator. An older delayed
write must never overwrite a newer revision.

Keep a bounded retention policy and record why a snapshot was rejected. Recovery data is not a
substitute for exporting user-visible files or synchronizing collaboration intent.

## Worker extension RPC

Run optional extension logic behind a dedicated Worker boundary with an allowlisted method set,
version handshake, structured-clone input budgets, transfer ownership rules, per-call timeout,
`AbortSignal`, bounded concurrency, deterministic result schema, and terminal disposal.

The Worker receives only required data and capabilities. It must not gain ambient media/network
access, mutate Session state directly, or return runtime objects into Project JSON. Treat extension
output as untrusted input and validate it before applying a transaction.
