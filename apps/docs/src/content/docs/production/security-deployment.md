---
title: Security checklist before launch
description: Configure headers, media authorization, untrusted input limits, Material trust, and local cleanup.
---

## 1. HTTPS and isolation

Use HTTPS. Enable COOP/COEP only after every required script, worker, worklet, font, image, and media
response has a compatible CORS/CORP policy. Verify `crossOriginIsolated` in the deployed origin.

## 2. Tight CSP

Allow only required origins for scripts, workers, connections, media, images, fonts, and styles.
Avoid `unsafe-eval`, arbitrary remote scripts, wildcard media credentials, and unreviewed Blob URL
use. Test the built runtime asset URLs.

## 3. Media authorization

Use short-lived, least-privilege credentials outside Project JSON. Restrict CORS origins, validate
range responses, avoid leaking signed URLs through logs/referrers, and revoke application access
when the user loses permission.

## 4. Treat Project as untrusted

Apply pre-schema structural budgets, canonical JSON checks, schema validation, reference/ownership
validation, time and execution limits, and server-side revalidation. Do not invoke getters,
iterators, executable extensions, or network fetches merely because a field exists.

## 5. Material trust is layered

Validate package shape, canonical identity, hashes/sizes, signature, publisher/revocation,
protocol/node versions, graph types and budgets. Custom Shader/WASM additionally requires explicit
host authorization, sandbox policy, resource/network permissions, and an offline implementation.

## 6. OPFS and local data

Use per-user logical ownership, quotas, retention, idempotent cleanup, and sign-out/account-delete
flows. Revoke object URLs. A cancelled/failed export must not leave an undisclosed partial file.

## 7. Supply chain

Pin the package manager and lockfile, review package exports and lifecycle scripts, run CI/package
dry-runs, publish with provenance and least-privilege Trusted Publishing, and verify npm integrity
and attestations.

## Launch acceptance

Exercise import, seek, preview, play, edit, export, cancellation, refresh recovery, permission
expiry, hostile Project/Material input, storage exhaustion, worker/worklet CSP, and disposal on the
real production origin.
