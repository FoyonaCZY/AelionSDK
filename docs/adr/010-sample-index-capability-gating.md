# ADR-010：SampleIndex 原始容器字段按能力显式门控

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Media

## Context

专业随机访问索引理想上包含 PTS、原始 DTS、duration、sync、物理 byte offset、encoded size 与 codec config。Phase 0 固定的 Mediabunny 1.50.8 公共 API 能稳定提供 PTS、duration、sync、encoded size、codec config 和严格 decode order，但不承诺原始容器 DTS 或物理 sample offset。使用第三方私有对象补字段会把实现细节变成脆弱公开契约。

## Decision

- `SampleEntry.presentationTimestampUs` 表示源时间线 PTS；
- `SampleEntry.normalizedDecodeTimeUs` 是按 decode order 从零累积的单调内部时间，不伪装为容器 DTS；
- `decodeOrder` 与 `presentationOrder` 分离，足以驱动 Phase 0 的 GOP 选择和 B-frame exact seek；
- `byteLength`、track codec config 与 time base 保留；
- 原始 DTS 和 physical byte offset 仅在 adapter 能可靠提供时出现，并由 `SampleIndex.capabilities.rawDecodeTimestamps/byteOffsets` 门控；
- 当前 Mediabunny adapter 对两项返回 `false`，并产生 `MEDIA_RAW_DTS_UNAVAILABLE`、`MEDIA_SAMPLE_OFFSET_UNAVAILABLE`；
- Phase 1 若需要 CDN 精确 byte planning、跨容器 remux 或原始时间戳取证，应扩展/替换 adapter，不能读取第三方私有属性。

## Alternatives

- 把 `sequenceNumber` 当 offset：拒绝；它只保证相对 decode order；
- 用 duration 累计值标成 DTS：拒绝；这会把 normalized timeline 误报为原始容器语义；
- 访问 Mediabunny 私有 sample table：拒绝；升级、fragmented MP4 和 WebM 的结构均不稳定；
- Phase 0 自研完整 MP4/WebM parser：推迟到有明确消费者和性能收益时再评估。

## Consequences

- Phase 0 exact seek、decode amplification 与资源结论仍成立；
- 原始 DTS/offset 不是 Phase 0 已支持能力，而是可探测的 adapter 扩展；
- 技术设计中的理想 v1 索引结构保留为目标模型，但实现必须按 capability 使用可选字段；
- 上层不能在 capability 为 `false` 时依赖 raw DTS 或 byte offset。

## Evidence

- 五类 MP4/WebM corpus 均保留 PTS、decode/presentation order、duration、sync、size 与 codec config；
- B-frame 与 VFR exact seek 在 Chromium、Firefox 通过；
- `reports/baseline/media-seek-chromium.json` 显式记录 adapter capability 与 diagnostics；
- 适配器审计确认公共 `EncodedPacket` 没有 byte offset 或 raw DTS 字段。
