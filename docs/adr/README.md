# AelionSDK Architecture Decision Records

ADR 记录会长期影响公开协议、线程边界、执行语义或技术范围的决策。

状态：

- Proposed：方向已提出，仍需要实现或证据；
- Accepted：证据支持，后续实现必须遵循；
- Rejected：方案已评审但不采用；
- Superseded：被新 ADR 显式替代。

| ADR | 标题 | 状态 |
|---|---|---|
| [001](001-project-json-and-transaction.md) | JSON 是 Project 协议，不是实时命令流 | Accepted |
| [002](002-integer-microsecond-time.md) | 公开时间使用整数微秒与有理数帧率 | Accepted |
| [003](003-normalized-project-entities.md) | Project 使用 normalized entity maps | Accepted |
| [004](004-shared-render-ir.md) | Preview 与 Export 共用 Render IR | Accepted |
| [005](005-capability-selected-backends.md) | WebCodecs/WebGPU 优先并按 capability 选择 | Accepted |
| [006](006-audio-master-clock.md) | 有声播放由 AudioWorklet 驱动主时钟 | Accepted |
| [007](007-offline-streaming-export.md) | Export 使用离线逐帧与流式背压 | Accepted |
| [008](008-no-project-executable-code.md) | Project 不携带可执行代码 | Accepted |
| [009](009-media-container-adapter.md) | Mediabunny 作为 Phase 0 容器适配器 | Accepted |
| [010](010-sample-index-capability-gating.md) | SampleIndex 原始容器字段按能力显式门控 | Accepted |
| [011](011-phase-0-certified-scope.md) | Phase 0 认证范围与性能降级 | Accepted |
| [012](012-alpha-public-api.md) | 以 Session Facade 冻结 Alpha 公开 API | Accepted |
| [013](013-multi-package-and-tarball-consumer.md) | 多包发布且以真实 tarball consumer 为分发门禁 | Accepted |
| [014](014-premultiplied-multi-layer-composition.md) | 视觉轨道按 Project 顺序做 premultiplied alpha-over | Accepted |
| [015](015-material-authoring-integrity-and-trust.md) | Material Authoring 使用确定性包、精确 integrity 与显式信任 | Accepted |
