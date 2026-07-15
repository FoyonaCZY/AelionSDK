# AelionSDK Alpha Diagnostic Codes

> 对应源码版本：`0.1.0-alpha.0`  
> 规则：业务分支只依赖 `code` 和结构化字段，不解析英文 `message`

## 1. Diagnostic 结构

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

- `code`：稳定的机器标识；同一语义不因浏览器原始错误文案变化；
- `severity`：展示和 stop policy，不等价于 HTTP status；
- `recoverable`：表示调用方修正输入、能力组合或资源后可以重试，不表示 SDK 已自动重试；
- `path`：JSON/Graph/operation 路径；
- `entityId`、`rangeUs`：定位工程实体和受影响时间；
- `details`：可记录 codec/backend/limit 等结构化上下文；
- `cause`：只用于日志/调试，不序列化进 Project，也不能作为稳定业务条件。

结构化诊断可能通过 `AelionError.diagnostics`、`Result.diagnostics`、capability report、export preflight 或 Session `diagnostic` event 返回。`TimeError`/`CanonicalizationError` 直接在 error 上提供 `.code`。当前 Material package registry 的部分拒绝仍是 `TypeError`/`ReferenceError`，code 位于 message 前缀；这是 Alpha 兼容层，不建议上层长期解析，后续会统一为结构化 `AelionError`。

参数/生命周期前置条件仍可能用标准 `RangeError`、`TypeError`、`ReferenceError` 表达，例如无 MediaProvider、dispose 后调用、非法 seek、重复 Player subscriber 或重复 Material runtime registration。这些不是可枚举 diagnostic code；调用方应在类型/UI 状态层预防，并按 error class 处理，不解析英文 message。

底层浏览器取消还可能直接返回 `DOMException` 且 `name === 'AbortError'`。业务取消处理应同时接受它与 `OPERATION_ABORTED`。

## 2. 通用、时间与 canonical JSON

| Code | 含义与建议 |
|---|---|
| `OPERATION_ABORTED` | 调用方 AbortSignal 已取消操作；通常可恢复，不自动显示为故障 |
| `TIME_NOT_SAFE_INTEGER` | 微秒值不是安全整数或违反非负约束；修正时间输入 |
| `RATIONAL_INVALID` | 帧率/采样率等有理数的分子、分母无效 |
| `INDEX_NOT_SAFE_INTEGER` | frame/sample index 不是非负安全整数 |
| `TIME_RESULT_OUT_OF_RANGE` | 时间换算结果超出 JavaScript 安全整数范围 |
| `CANONICAL_UNSUPPORTED_VALUE` | Project canonical JSON 出现 `undefined`、函数等非 JSON 值 |
| `CANONICAL_NON_FINITE_NUMBER` | 出现 `NaN` 或正负无穷 |
| `CANONICAL_NEGATIVE_ZERO` | 出现会破坏 canonical 等价的 `-0` |
| `CANONICAL_UNSAFE_INTEGER` | 整数超过安全范围，无法稳定序列化/比较 |

## 3. Project

| Code | 含义与建议 |
|---|---|
| `PROJECT_SCHEMA_INVALID` | Project 不符合 v1 JSON Schema；查看 `path` 和校验 details |
| `PROJECT_INPUT_INVALID` | Project 在 Schema 前包含非纯 JSON/不安全结构，例如 accessor、稀疏数组、symbol、循环/对象别名或非 canonical number；SDK 不调用 getter/iterator，并返回一条有界诊断 |
| `PROJECT_INPUT_LIMIT_EXCEEDED` | Project 在 Schema 前超过 Alpha 不可信输入预算：深度 64、262,144 values、数组 16,384、对象 4,096、单字符串 4 MiB 或字符串总量 16 MiB |
| `PROJECT_ENTITY_KEY_MISMATCH` | normalized map key 与实体 `id` 不一致 |
| `PROJECT_REFERENCE_MISSING` | ID 引用的实体不存在；不可用“忽略”修复编辑语义 |
| `PROJECT_DUPLICATE_REFERENCE` | 有序 ID list 含重复引用 |
| `PROJECT_HOST_MISMATCH` | Track/Item 等实体被错误的 Sequence/Track 列表持有 |
| `PROJECT_MATERIAL_MULTIPLE_OWNERS` | 同一 MaterialInstance 被多个 host 拥有 |
| `PROJECT_MATERIAL_ORPHAN` | MaterialInstance 没有合法 owner |
| `PROJECT_VISUAL_TRANSITION_OVERLAP` | 同一 Sequence 的 visual Transition 时间区间重叠；拆分或调整区间，避免运行时选择歧义 |
| `PROJECT_AUDIO_TIME_MAPPING_UNSUPPORTED` | 本 Alpha 的音频仅支持 forward 1x linear；变速/倒放须在导入阶段烘焙或等待后续版本 |

## 4. Transaction、History 与编辑命令

### 4.1 原子 operation

| Code | 含义与建议 |
|---|---|
| `REVISION_CONFLICT` | `baseRevision` 已过期；刷新 snapshot 后重新生成意图 |
| `TRANSACTION_EMPTY` | Transaction 没有 operation；不要提交 no-op |
| `TRANSACTION_ENTITY_EXISTS` | create 的实体 ID 已存在 |
| `TRANSACTION_ENTITY_ID_MISMATCH` | operation ID 与 `value.id` 不一致 |
| `TRANSACTION_ENTITY_MISSING` | operation 目标实体不存在 |
| `TRANSACTION_PATH_INVALID` | field path 为空或中间节点不是 object |
| `TRANSACTION_FIELD_MISSING` | remove 的 field 不存在 |
| `TRANSACTION_LIST_INVALID` | 目标不是 string ID list |
| `TRANSACTION_LIST_DUPLICATE` | listInsert 会产生重复 ID |
| `TRANSACTION_LIST_VALUE_MISSING` | listRemove/listMove 的目标不在 list |
| `TRANSACTION_LIST_ANCHOR_MISSING` | `beforeId` 不在目标 list |
| `TRANSACTION_LIST_ANCHOR_INVALID` | 试图把元素移动到自己之前 |
| `TRANSACTION_REENTRANT` | transaction callback、preparation 或 commit observer 同步发起了嵌套事务 |
| `HISTORY_REENTRANT` | undo/redo/edit 及其通知尚未完成时同步修改 history |
| `HISTORY_UNDO_EMPTY` | 没有可撤销记录；先检查 `canUndo` |
| `HISTORY_REDO_EMPTY` | 没有可重做记录；先检查 `canRedo` |
| `HISTORY_REVISION_DIVERGED` | History 与 engine revision 被外部 edit 分叉；重新建立 history/session |

### 4.2 语义命令

| Code | 含义与建议 |
|---|---|
| `COMMAND_TIME_INVALID` | 命令时间不是非负安全整数 |
| `COMMAND_ITEM_MISSING` | Item 不存在 |
| `COMMAND_ITEM_EXISTS` | 新 Item/right split ID 已存在 |
| `COMMAND_TRACK_MISSING` | Track 不存在 |
| `COMMAND_TRACK_LOCKED` | Track 已锁；先显式解锁或拒绝 UI 操作 |
| `COMMAND_TRACK_KIND_MISMATCH` | Item 类型与 visual/audio/caption Track 不兼容 |
| `COMMAND_ITEM_ANCHOR_MISSING` | Item 排序 anchor 不属于目标 Track |
| `COMMAND_ITEM_ANCHOR_INVALID` | Item 不能移动到自己之前 |
| `COMMAND_TRACK_ANCHOR_MISSING` | Track 排序 anchor 不属于目标 Sequence |
| `COMMAND_TRACK_SEQUENCE_MISMATCH` | Track 不属于指定 Sequence |
| `COMMAND_TRACK_AUDIO_REQUIRED` | mute 命令目标不是带 mixer 属性的 Audio Track |
| `COMMAND_NO_CHANGE` | 命令没有产生语义变化 |
| `COMMAND_TIME_MAPPING_UNSUPPORTED` | 当前命令无法安全修改该非线性/未知 time mapping |
| `COMMAND_SOURCE_RANGE_EMPTY` | trim 后 source range 将为空 |
| `COMMAND_SOURCE_SPLIT_OUT_OF_RANGE` | split 映射出的 source range 越界 |
| `COMMAND_TRIM_OUT_OF_RANGE` | trim 点不在 Item 内部 |
| `COMMAND_TRIM_TRANSITION_CONFLICT` | trim 会破坏 Transition 覆盖范围 |
| `COMMAND_TRIM_ANIMATION_UNSUPPORTED` | Item 含动画但尚无明确 keyframe trim policy |
| `COMMAND_SPLIT_OUT_OF_RANGE` | split 点不在 Item 内部 |
| `COMMAND_SPLIT_TRANSITION_CONFLICT` | split 点切入 Transition 范围 |
| `COMMAND_SPLIT_OWNED_ENTITY_UNSUPPORTED` | Item-owned Material/Marker 尚无 split policy |
| `COMMAND_SPLIT_ANIMATION_UNSUPPORTED` | 动画 Item 尚无 keyframe split policy |
| `COMMAND_SPLIT_LINKED_UNSUPPORTED` | linked Item 必须先 unlink 或使用未来的 group split |
| `COMMAND_REPLACE_TOPOLOGY_CHANGED` | replace 改变 id/track；应改用 move/结构命令 |
| `COMMAND_REPLACE_OWNERSHIP_CHANGED` | replace 改变 Material/Marker/Link ownership |
| `COMMAND_TRANSITION_TRACK_CONFLICT` | 跨 Track move 会使已有 Transition 非法；先移除/重建 Transition |

当前 Alpha 没有 ripple/roll/slip/slide、group split 和 solo 命令；没有 code 不表示这些能力被通用 `setField` 支持。

## 5. Media

| Code | 含义与建议 |
|---|---|
| `MEDIA_INPUT_INVALID` | 容器损坏、格式不支持或无法探测；不可恢复为同一输入 |
| `MEDIA_NETWORK_OR_CORS_FAILED` | 网络、鉴权或 CORS 阻止 HEAD/Range；检查部署和凭据 |
| `MEDIA_RANGE_UNSUPPORTED` | 服务端忽略 Range；小文件可显式全量 fallback，大文件应拒绝 |
| `MEDIA_RANGE_REQUEST_FAILED` | Range 返回非预期 HTTP status/content range |
| `MEDIA_RAW_DTS_UNAVAILABLE` | 当前 container adapter 不提供原始 DTS；不要用 normalized decode time 冒充 |
| `MEDIA_SAMPLE_OFFSET_UNAVAILABLE` | 当前 adapter 不提供稳定 physical byte offset |

## 6. Capability

| Code | 含义与建议 |
|---|---|
| `CAPABILITY_CODEC_API_UNAVAILABLE` | 当前环境没有相应 WebCodecs constructor |
| `CAPABILITY_CODEC_CONFIG_UNSUPPORTED` | API 存在但指定 codec/config 不支持；选择明确 fallback/profile |
| `CAPABILITY_CODEC_PROBE_FAILED` | config probe 自身抛错；保留 cause 并按 unsupported 处理 |
| `CAPABILITY_WORKER_UNAVAILABLE` | Worker 不可用 |
| `CAPABILITY_OFFSCREEN_CANVAS_UNAVAILABLE` | OffscreenCanvas 不可用 |
| `CAPABILITY_WEBGL2_UNAVAILABLE` | 无法创建 WebGL2 context |
| `CAPABILITY_WEBGL2_PROBE_FAILED` | WebGL2 probe 异常失败 |
| `CAPABILITY_WEBGPU_UNAVAILABLE` | `navigator.gpu` 不可用；Alpha 默认可回退 WebGL2 |
| `CAPABILITY_WEBGPU_ADAPTER_UNAVAILABLE` | API 存在但没有 adapter |
| `CAPABILITY_WEBGPU_PROBE_FAILED` | WebGPU probe 异常失败 |
| `CAPABILITY_AUDIO_CONTEXT_UNAVAILABLE` | AudioContext 不可用 |
| `CAPABILITY_AUDIO_WORKLET_UNAVAILABLE` | AudioWorklet 不可用 |
| `CAPABILITY_SHARED_ARRAY_BUFFER_ISOLATION_REQUIRED` | 缺 COOP/COEP；将使用有界 Transferable fallback，性能降级 |
| `CAPABILITY_OPFS_UNAVAILABLE` | OPFS 不可用；选择 Memory/业务 Writable Sink |
| `CAPABILITY_FILE_SYSTEM_ACCESS_UNAVAILABLE` | save picker 不可用；不影响 OPFS/自定义 Sink |
| `CAPABILITY_TRANSFERABLE_STREAMS_UNAVAILABLE` | 必要 Web Streams primitive 不可用 |
| `CAPABILITY_WEBASSEMBLY_UNAVAILABLE` | WebAssembly 不可用 |

`COMPATIBILITY_RUNTIME_BLOCKED` 是仓库 evidence runner 的环境阻塞码，不是 SDK runtime capability。它不能被解释为浏览器通过或不支持。

## 7. Renderer

Player runtime failures surface as `PLAYER_RUNTIME_FAILED` when the underlying media,
AudioWorklet, scheduler, or renderer error does not already carry structured diagnostics.
The Player enters `error` state and can be rebuilt by loading the Project again.

| Code | 含义与建议 |
|---|---|
| `PLAYER_RUNTIME_FAILED` | 播放期媒体、音频时钟或视频调度失败；停止当前播放并重建/重试 |
| `RENDERER_QUEUE_FULL` | 已接收且尚未完成资源清理（包括取消中）的 composition 达到硬上限；降低生产速率并等待旧请求终态确认 |
| `RENDERER_FRAME_QUEUE_FULL` | 完整帧评估在媒体解码前达到硬上限；取消过期 preview/scrub 后重试 |
| `MEDIA_PROVIDER_QUEUE_FULL` | `ByteMediaProvider` 的公开调用或底层 operation 队列达到硬上限；取消过期请求、等待在途工作 settle，或按内存预算调整并发参数 |
| `RENDERER_WEBGPU_DEVICE_LOST` | WebGPU device lost；若允许则回退/重建，否则停止 |
| `RENDERER_WEBGPU_FAILED` | WebGPU 组合失败且可按配置尝试 WebGL2 |
| `RENDERER_WEBGL_CONTEXT_LOST` | WebGL2 context lost；释放并重建 Session/renderer |
| `RENDERER_WORKER_COMPOSE_FAILED` | Worker 内未归类的合成失败 |

Worker 取消可能直接返回 `DOMException('AbortError')`，不会产生 `RENDERER_*` 故障码。

## 8. Material

| Code | 含义与建议 |
|---|---|
| `MATERIAL_PROTOCOL_UNSUPPORTED` | protocol/node set 版本不兼容 |
| `MATERIAL_PACKAGE_INVALID` | 包路径、声明文件集合或 payload 结构非法 |
| `MATERIAL_INTEGRITY_MISMATCH` | canonical manifest、expected integrity 或 payload hash/size 不一致 |
| `MATERIAL_MISSING` | 精确 package/integrity/material 未安装 |
| `MATERIAL_DEFINITION_INVALID` | kind/host port/参数/default/manifest identity 无效 |
| `MATERIAL_GRAPH_INVALID` | Definition 要求 Graph 但 payload/结构无效 |
| `MATERIAL_GRAPH_DUPLICATE_NODE` | Graph node ID 重复 |
| `MATERIAL_DEPENDENCY_CYCLE` | Graph DAG 出现环 |
| `MATERIAL_GRAPH_NODE_MISSING` | binding 引用不存在 node |
| `MATERIAL_NODE_UNSUPPORTED` | Core Node/typeVersion 不在当前 node set |
| `MATERIAL_GRAPH_INPUT_MISSING` | Node 必填 input 缺失 |
| `MATERIAL_GRAPH_INPUT_UNKNOWN` | Node 包含未知 input |
| `MATERIAL_GRAPH_PARAMETER_MISSING` | binding 引用未知 parameter |
| `MATERIAL_GRAPH_PORT_MISSING` | binding 引用未知 host input port |
| `MATERIAL_GRAPH_SYSTEM_MISSING` | binding 引用未知 system value |
| `MATERIAL_GRAPH_OUTPUT_MISSING` | binding 引用未知 node output |
| `MATERIAL_GRAPH_OUTPUT_INVALID` | Graph result 不是 `visual-frame` |
| `MATERIAL_GRAPH_LITERAL_TYPE_INVALID` | literal 无法映射到支持类型 |
| `MATERIAL_GRAPH_RESOURCE_UNTYPED` | resource binding 缺少显式 typed node |
| `MATERIAL_GRAPH_TYPE_MISMATCH` | 连接两端端口类型不一致 |
| `MATERIAL_BUDGET_EXCEEDED` | node/depth/pass/texture sample 超出 host 静态预算 |
| `MATERIAL_INSTANCE_INVALID` | instance 参数、资源或 input binding 无效 |
| `MATERIAL_PARAMETER_OUT_OF_RANGE` | 数值参数超 Definition hard range |
| `MATERIAL_TRUST_REQUIRED` | Shader/WASM 未同时满足 trusted package、显式授权和 publisher allowlist |
| `MATERIAL_BACKEND_UNAVAILABLE` | 没有指定 backend 的可执行 implementation |

协议还保留 `MATERIAL_COMPILE_FAILED`、`MATERIAL_EXECUTION_FAILED` 等面向未来的目录项；当前源码不会稳定发出这些 code，因此本 Alpha runtime 表不把它们列为已实现事件。

## 9. Export

| Code | 含义与建议 |
|---|---|
| `EXPORT_REVISION_MISMATCH` | Project revision 与 frozen Render IR 不一致 |
| `EXPORT_CHANNEL_LAYOUT_UNSUPPORTED` | 输出 channel layout 不在 exporter 支持范围 |
| `EXPORT_SINK_LOCKED` | WritableStream 已被其他 writer lock；创建新 Sink |
| `EXPORT_VIDEO_ENCODER_UNAVAILABLE` | VideoEncoder 不可用 |
| `EXPORT_VIDEO_CONFIG_UNSUPPORTED` | VP9 config probe 失败 |
| `EXPORT_AUDIO_ENCODER_UNAVAILABLE` | AudioEncoder 不可用 |
| `EXPORT_AUDIO_CONFIG_UNSUPPORTED` | Opus config probe 失败 |
| `EXPORT_MATERIAL_BACKEND_UNAVAILABLE` | 启用的 Material 没有 offline backend |
| `EXPORT_JOB_ACTIVE` | 同一 Session 已有运行中的导出；等待完成或先调用 `cancel()` |
| `EXPORT_ENCODER_INIT_FAILED` | encoder/muxer 初始化失败 |
| `EXPORT_VIDEO_RENDER_FAILED` | frozen IR 的视频帧渲染失败 |
| `EXPORT_VIDEO_ENCODER_FAILED` | VideoEncoder 拒绝 frame |
| `EXPORT_AUDIO_RENDER_FAILED` | PCM mixer/source 失败 |
| `EXPORT_AUDIO_ENCODER_FAILED` | AudioEncoder 拒绝 PCM block |
| `EXPORT_STORAGE_WRITE_FAILED` | 配额、磁盘或 Sink write 失败；清除 partial output 后重试 |
| `EXPORT_MUX_OR_SINK_FAILED` | finalize/mux/未分类 Sink 失败 |

同一 Session 并发启动第二个 export 会抛出 `AelionError`，其 `diagnostics` 包含稳定的 `EXPORT_JOB_ACTIVE`；上层仍可先检查 `session.export.activeJob`，或等待/取消当前 job。英文 `message` 只用于展示，业务分支必须使用 diagnostic code。

## 10. 日志与遥测建议

记录：SDK/package version、Project/IR revision、code/severity/recoverable、entity/range/path、backend/codec config、浏览器版本、操作 stage、是否由用户取消。不要记录媒体 URL token、Project 文案、完整 Shader source、用户文件内容或跨会话稳定设备指纹。

遇到未知 code 时使用安全默认：显示通用错误、停止可能损坏输出的操作、保留原始 diagnostic 用于上报；不要因为不认识 code 就静默继续导出。
