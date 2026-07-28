---
title: Diagnostic codes
description: Look up stable error codes, recoverability, location fields, and recommended handling.
---

This catalog describes `1.0.0-rc.1`. Product branches must use `code` and structured fields, not
the English `message`. `recoverable: true` means retry can make sense after the caller changes a
condition; it does not mean the SDK already retried.

```ts
interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  message: string;
  path?: readonly (string | number)[];
  entityId?: string;
  rangeUs?: { startUs: number; durationUs: number };
  recoverable: boolean;
  details?: Readonly<Record<string, JsonValue>>;
  cause?: unknown;
}
```

Diagnostics appear in `AelionError`, `Result`, capability/preflight reports, and Session diagnostic
events. Standard `TypeError`/`RangeError` still represent programmer/lifecycle preconditions, and a
cancelled browser operation may be a `DOMException` named `AbortError`.

## General and canonical data

| Code                          | Meaning                                              |
| ----------------------------- | ---------------------------------------------------- |
| `OPERATION_ABORTED`           | Caller cancelled; normally do not present as a fault |
| `TIME_NOT_SAFE_INTEGER`       | Invalid or disallowed microsecond value              |
| `RATIONAL_INVALID`            | Invalid rational numerator/denominator               |
| `INDEX_NOT_SAFE_INTEGER`      | Invalid frame/sample index                           |
| `TIME_RESULT_OUT_OF_RANGE`    | Conversion exceeded safe integer range               |
| `CANONICAL_UNSUPPORTED_VALUE` | Non-JSON value such as `undefined` or function       |
| `CANONICAL_NON_FINITE_NUMBER` | `NaN` or infinity                                    |
| `CANONICAL_NEGATIVE_ZERO`     | Canonically unstable `-0`                            |
| `CANONICAL_UNSAFE_INTEGER`    | Integer cannot be represented canonically            |

## Project

| Code                                     | Meaning                                                       |
| ---------------------------------------- | ------------------------------------------------------------- |
| `PROJECT_SCHEMA_INVALID`                 | Project failed v1 JSON Schema                                 |
| `PROJECT_INPUT_INVALID`                  | Non-plain, cyclic/aliased, accessor, sparse, or unsafe input  |
| `PROJECT_INPUT_LIMIT_EXCEEDED`           | Pre-schema depth/value/array/object/string budget exceeded    |
| `PROJECT_ENTITY_KEY_MISMATCH`            | Map key differs from entity ID                                |
| `PROJECT_REFERENCE_MISSING`              | Referenced entity does not exist                              |
| `PROJECT_DUPLICATE_REFERENCE`            | Ordered ID list contains a duplicate                          |
| `PROJECT_HOST_MISMATCH`                  | Entity is owned by the wrong Sequence/Track                   |
| `PROJECT_MATERIAL_MULTIPLE_OWNERS`       | Material instance has more than one owner                     |
| `PROJECT_MATERIAL_ORPHAN`                | Material instance has no valid owner                          |
| `PROJECT_VISUAL_TRANSITION_OVERLAP`      | Ambiguous overlapping transitions                             |
| `PROJECT_TIME_MAPPING_ENDPOINT_INVALID`  | Curve endpoints do not cover the required range               |
| `PROJECT_TIME_MAPPING_ORDER_INVALID`     | Curve points are not a deterministic monotonic mapping        |
| `PROJECT_NESTED_SEQUENCE_CYCLE`          | Nested sequences form a cycle                                 |
| `PROJECT_MASK_SOURCE_INVALID`            | Missing, cross-sequence, or self-referential mask             |
| `PROJECT_AUDIO_FADE_OUT_OF_RANGE`        | Fade exceeds item duration                                    |
| `PROJECT_AUDIO_PITCH_POLICY_UNSUPPORTED` | Pitch-preserve requested for unsupported mapping              |
| `PROJECT_HDR_FORMAT_INVALID`             | HDR metadata/working-space/bit-depth contract is inconsistent |

## Transaction, history, and commands

| Code                                                                  | Meaning                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `REVISION_CONFLICT`                                                   | Base revision is stale; rebuild intent from the latest snapshot |
| `TRANSACTION_EMPTY`                                                   | No operation                                                    |
| `TRANSACTION_ENTITY_EXISTS` / `TRANSACTION_ENTITY_MISSING`            | Create/target identity conflict                                 |
| `TRANSACTION_ENTITY_ID_MISMATCH`                                      | Operation ID differs from `value.id`                            |
| `TRANSACTION_PATH_INVALID` / `TRANSACTION_FIELD_MISSING`              | Invalid field path/removal                                      |
| `TRANSACTION_LIST_INVALID` / `TRANSACTION_LIST_DUPLICATE`             | Invalid normalized ID list                                      |
| `TRANSACTION_LIST_VALUE_MISSING`                                      | Remove/move target absent                                       |
| `TRANSACTION_LIST_ANCHOR_MISSING` / `TRANSACTION_LIST_ANCHOR_INVALID` | Invalid ordering anchor                                         |
| `TRANSACTION_REENTRANT`                                               | Synchronous nested transaction is forbidden                     |
| `TRANSACTION_OPERATION_LIMIT_EXCEEDED`                                | One transaction exceeded the operation budget                   |
| `HISTORY_REENTRANT`                                                   | History mutation attempted during a history transition          |
| `HISTORY_UNDO_EMPTY` / `HISTORY_REDO_EMPTY`                           | No corresponding entry                                          |
| `HISTORY_REVISION_DIVERGED`                                           | History and engine revisions forked                             |
| `HISTORY_GROUP_NOT_ACTIVE`                                            | Interaction group handle is stale                               |

Semantic command codes include `COMMAND_TIME_INVALID`, `COMMAND_ITEM_MISSING`,
`COMMAND_ITEM_EXISTS`, `COMMAND_TRACK_MISSING`, `COMMAND_TRACK_LOCKED`,
`COMMAND_TRACK_KIND_MISMATCH`, `COMMAND_ITEM_ANCHOR_*`, `COMMAND_TRACK_ANCHOR_MISSING`,
`COMMAND_TRACK_SEQUENCE_MISMATCH`, `COMMAND_TRACK_AUDIO_REQUIRED`, `COMMAND_NO_CHANGE`,
`COMMAND_TIME_MAPPING_UNSUPPORTED`, `COMMAND_SOURCE_RANGE_EMPTY`,
`COMMAND_SOURCE_SPLIT_OUT_OF_RANGE`, `COMMAND_TRIM_*`, `COMMAND_SPLIT_*`,
`COMMAND_REPLACE_TOPOLOGY_CHANGED`, `COMMAND_REPLACE_OWNERSHIP_CHANGED`, and
`COMMAND_TRANSITION_TRACK_CONFLICT`. Professional edits use the more specific
`COMMAND_RIPPLE_*`, `COMMAND_ROLL_*`, `COMMAND_SLIDE_*`, `COMMAND_LINK_GROUP_*`, and
`COMMAND_SOURCE_HANDLE_UNAVAILABLE` families.

## Media

| Code                                                      | Meaning                                        |
| --------------------------------------------------------- | ---------------------------------------------- |
| `MEDIA_INPUT_INVALID`                                     | Corrupt, unsupported, or unprobeable input     |
| `MEDIA_NETWORK_OR_CORS_FAILED`                            | Network, authorization, or CORS blocked access |
| `MEDIA_RANGE_UNSUPPORTED`                                 | Server ignored required byte ranges            |
| `MEDIA_RANGE_REQUEST_FAILED`                              | Invalid range status or content range          |
| `MEDIA_RAW_DTS_UNAVAILABLE`                               | Adapter cannot provide raw DTS                 |
| `MEDIA_SAMPLE_OFFSET_UNAVAILABLE`                         | Adapter cannot provide stable physical offset  |
| `MEDIA_PROXY_DURATION_MISMATCH`                           | Proxy duration differs from original           |
| `MEDIA_RESOURCE_REQUEST_EXCEEDS_PAGE_BUDGET`              | One request exceeds the page resource budget   |
| `MEDIA_RESOURCE_QUEUE_FULL` / `MEDIA_PROVIDER_QUEUE_FULL` | Bounded admission queue is full                |

## Capability and renderer

Capability codes are `CAPABILITY_CODEC_API_UNAVAILABLE`, `CAPABILITY_CODEC_CONFIG_UNSUPPORTED`,
`CAPABILITY_CODEC_PROBE_FAILED`, `CAPABILITY_WORKER_UNAVAILABLE`,
`CAPABILITY_OFFSCREEN_CANVAS_UNAVAILABLE`, `CAPABILITY_WEBGL2_*`, `CAPABILITY_WEBGPU_*`,
`CAPABILITY_AUDIO_CONTEXT_UNAVAILABLE`, `CAPABILITY_AUDIO_WORKLET_UNAVAILABLE`,
`CAPABILITY_SHARED_ARRAY_BUFFER_ISOLATION_REQUIRED`, `CAPABILITY_OPFS_UNAVAILABLE`,
`CAPABILITY_FILE_SYSTEM_ACCESS_UNAVAILABLE`, `CAPABILITY_TRANSFERABLE_STREAMS_UNAVAILABLE`,
`CAPABILITY_WEBASSEMBLY_UNAVAILABLE`, and the `CAPABILITY_*COLOR*`/display-query codes.

Renderer/runtime codes are `PLAYER_RUNTIME_FAILED`, `RENDERER_QUEUE_FULL`,
`RENDERER_FRAME_QUEUE_FULL`, `RENDERER_WEBGPU_DEVICE_LOST`, `RENDERER_WEBGPU_FAILED`,
`RENDERER_WEBGL_CONTEXT_LOST`, `RENDERER_WEBGL_ADMISSION_TIMEOUT`, and
`RENDERER_WORKER_COMPOSE_FAILED`.

## Material

Material diagnostics cover protocol/package/integrity/identity, graph structure and typed bindings,
static/runtime budgets, instance parameters/resources, backend availability, trust/signature/
publisher, permissions, and migrations. Stable codes include:

`MATERIAL_PROTOCOL_UNSUPPORTED`, `MATERIAL_PACKAGE_INVALID`, `MATERIAL_INTEGRITY_MISMATCH`,
`MATERIAL_MISSING`, `MATERIAL_DEFINITION_INVALID`, `MATERIAL_GRAPH_INVALID`,
`MATERIAL_GRAPH_DUPLICATE_NODE`, `MATERIAL_DEPENDENCY_CYCLE`, `MATERIAL_GRAPH_NODE_MISSING`,
`MATERIAL_NODE_UNSUPPORTED`, `MATERIAL_GRAPH_INPUT_MISSING`, `MATERIAL_GRAPH_INPUT_UNKNOWN`,
`MATERIAL_GRAPH_PARAMETER_MISSING`, `MATERIAL_GRAPH_PORT_MISSING`,
`MATERIAL_GRAPH_SYSTEM_MISSING`, `MATERIAL_GRAPH_OUTPUT_MISSING`,
`MATERIAL_GRAPH_OUTPUT_INVALID`, `MATERIAL_GRAPH_LITERAL_TYPE_INVALID`,
`MATERIAL_GRAPH_RESOURCE_UNTYPED`, `MATERIAL_GRAPH_TYPE_MISMATCH`,
`MATERIAL_BUDGET_EXCEEDED`, `MATERIAL_INSTANCE_INVALID`, `MATERIAL_PARAMETER_OUT_OF_RANGE`,
`MATERIAL_TRUST_REQUIRED`, `MATERIAL_BACKEND_UNAVAILABLE`, `MATERIAL_SIGNATURE_INVALID`,
`MATERIAL_PUBLISHER_UNTRUSTED`, `MATERIAL_NETWORK_PERMISSION_DENIED`,
`MATERIAL_SHADER_PERMISSION_DENIED`, `MATERIAL_WASM_PERMISSION_DENIED`,
`MATERIAL_MIGRATION_INVALID`, and `MATERIAL_EXECUTION_BUDGET_DENIED`.

## Export and color

Export codes include `EXPORT_REVISION_MISMATCH`, `EXPORT_CHANNEL_LAYOUT_UNSUPPORTED`,
`EXPORT_SINK_LOCKED`, `EXPORT_VIDEO_ENCODER_UNAVAILABLE`, `EXPORT_VIDEO_CONFIG_UNSUPPORTED`,
`EXPORT_AUDIO_ENCODER_UNAVAILABLE`, `EXPORT_AUDIO_CONFIG_UNSUPPORTED`,
`EXPORT_MATERIAL_BACKEND_UNAVAILABLE`, `EXPORT_JOB_ACTIVE`, `EXPORT_ENCODER_INIT_FAILED`,
`EXPORT_VIDEO_RENDER_FAILED`, `EXPORT_VIDEO_ENCODER_FAILED`, `EXPORT_AUDIO_RENDER_FAILED`,
`EXPORT_AUDIO_ENCODER_FAILED`, `EXPORT_STORAGE_WRITE_FAILED`, `EXPORT_MUX_OR_SINK_FAILED`,
`EXPORT_IMAGE_CANVAS_UNAVAILABLE`, `EXPORT_IMAGE_WRITE_FAILED`, `EXPORT_AUDIO_WRITE_FAILED`,
`REMOTE_EXPORT_AUTH_INVALID`, `REMOTE_EXPORT_AUTH_EXPIRED`, and `REMOTE_EXPORT_FAILED`.

Color failures use `COLOR_WORKING_SPACE_UNSUPPORTED`, `COLOR_TRANSFER_FUNCTION_UNSUPPORTED`,
`COLOR_BIT_DEPTH_UNSUPPORTED`, and `COLOR_HDR_PRESENTATION_UNSUPPORTED`; they must not silently
change the requested color/HDR contract.

## Logging

Log package/browser versions, Project/IR revision, code/severity/recoverable, entity/range/path,
safe backend/codec settings, stage, cancellation, and cleanup. Never log media URL tokens, user
files or Project text, complete Shader source, or a stable cross-session device fingerprint.
Unknown codes should use a safe default: stop output that may be invalid, show a generic message,
and retain the structured diagnostic for reporting.
