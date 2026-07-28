---
title: Integrate remote export
description: Authorize and submit a frozen Project to your own rendering service.
---

## Provider payload

The browser gives the provider a frozen canonical Project, revision and execution identity,
requested profile, material identities, and the media references your application chooses to make
available. It does not grant an arbitrary service access to local `File` objects.

## Short-lived authorization

Implement `RemoteExportAuthorizer` with a narrowly scoped, expiring token bound to the current
user, project/job identity, allowed profile, and service audience. Do not persist long-lived
credentials in Project JSON or logs.

## Provider responsibilities

`RemoteExportProvider` starts a job, returns a stable remote job identity, streams structured
progress, supports cancellation, resolves terminal output metadata, and cleans up failed
allocations. Validate response identity and authorization expiry on every transition.

## Server checks

The service must:

1. authenticate and authorize the request again;
2. apply the same untrusted-Project input budgets and schema/reference validation;
3. resolve immutable media and Material identities;
4. enforce codec, resource, network, font, and execution policy;
5. render from the frozen revision with a compatible engine/protocol version;
6. publish a durable result with retention and access controls.

## Refresh recovery

Persist only the remote job ID and safe status metadata. After reload, obtain fresh authorization
and ask the provider for current state; do not replay `start()` unless idempotency explicitly
allows it.

## Local/remote consistency

Pin exact media versions, Material integrity, fonts, color contract, engine version, and export
profile. Compare golden projects across local preview and server output. A remote renderer must
fail unsupported semantics rather than silently approximating them.
