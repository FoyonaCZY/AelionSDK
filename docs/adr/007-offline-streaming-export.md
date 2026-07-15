# ADR-007：Export 使用离线逐帧与流式背压

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Export/Media

## Context

录制实时 Canvas 会继承丢帧和墙钟速度；把整部成片聚合为 Blob 会造成峰值内存不可控。

## Decision

- Export 启动时冻结 Project revision；
- 按输出时间逐帧求值同一 Render IR；
- renderer → encoder → muxer → sink 每级都有界并传播背压；
- 输出优先流式写入 OPFS、FileSystemWritable 或宿主 Sink；
- 取消/失败明确清理 partial output。

## Alternatives

- MediaRecorder 录屏：拒绝作为确定性导出主路径；
- 全量帧/Chunk 驻留内存：拒绝；
- 默认只依赖远端渲染：保留为 fallback，不替代浏览器端目标。

## Consequences

需独立 parser/decoder 回读容器、时间戳、抽帧和 A/V sync。

## Evidence

- `packages/export` 已通过 WebCodecs VP9/Opus 和 Mediabunny `StreamTarget` 逐帧流式导出；
- 每次 source add 均等待背压，测试最大并发 Sink write 为 1；
- 取消前、编码中取消、存储不足和 encoder ingest failure 均有自动测试，partial sink 被 abort 并清空；
- 输出由新建容器输入重新建立 SampleIndex，并用 WebCodecs 解码指定帧；
- 30 秒输出含 900 个视频帧和 1,440,000 个音频帧，69 次 Sink 写入、最大并发 1，A/V 尾差 333 μs；
- 输出成片已由 FFmpeg 8.1 进程外完整解码视频与音频并记录 hash；
- 10 分钟等价音频使用固定 32.8 KiB buffer 且 heap 无线性增长；5 秒 1080p30 导出为 2.36× realtime；
- 导出仍观察到一次 93 ms 主线程 Long Task，ADR 的离线流式架构不变，但调度 Worker 化是 Phase 1 P0。
