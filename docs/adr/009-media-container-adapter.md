# ADR-009：Mediabunny 作为 Phase 0 容器适配器

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Media/Export

## Context

WebCodecs 不负责 MP4/WebM 解封装或封装。Phase 0 需要尽快验证随机访问、sample index、逐帧编码与流式 mux，同时不能把某个第三方库的对象模型变成公开协议。

## Decision

Phase 0 使用固定版本 Mediabunny 1.50.8 作为浏览器内 TypeScript 容器适配器。Aelion 保留并拥有以下稳定边界：

- AssetResolver / RangeReader；
- 规范化 SampleIndex；
- DecoderPool 与 Seek 策略；
- Render/Export 的 EncodedChunk 契约；
- Mux Sink、背压与诊断。

第三方类型不得出现在 Aelion 的 Project、Transaction、Render IR 或公开 API 中。

## Alternatives

- 自研 Rust/WASM MP4 与 WebM parser：长期可行，但 Phase 0 实现成本高；
- MP4Box + ts-ebml：许可证宽松，但两套 API 会增加规范化工作；
- FFmpeg/WASM：格式覆盖广，但包体、启动、随机访问与 GPU 拷贝不适合作为实时主路径；
- 只使用 video 元素：无法建立显式 SampleIndex 和逐帧离线链。

## Consequences

- MPL-2.0 文件级许可证必须进入 THIRD_PARTY_NOTICES；
- 依赖升级需要 corpus、Seek 和 mux 回读回归；
- 若性能、许可证或浏览器兼容性不达标，可在不改公开协议的情况下替换适配器。

## Evidence needed for Accepted

- MP4/WebM corpus 能转换为同一 SampleIndex；
- WebCodecs exact seek 通过 oracle；
- 至少一个流式 WebM 或 MP4 输出通过独立回读；
- 依赖许可证与 bundle 影响评审通过。

## Evidence

- 五个 CC0 corpus（moov-head/tail、fragmented、非零 PTS MP4、VFR WebM）统一转换为 SampleIndex；
- MP4 H.264 与 WebM VP9 的真实 WebCodecs exact seek 通过，AAC/Opus 解码为统一 `f32` PCM；
- WebM VP9/Opus 流式输出可重新 demux/index 并解码抽帧；
- MPL-2.0 固定版本 1.50.8 已进入 `THIRD_PARTY_NOTICES.md`；
- 输出还通过 FFmpeg 8.1 进程外完整音视频解码；原始 DTS/byte offset 的公共 API 边界由 ADR-010 显式门控。
