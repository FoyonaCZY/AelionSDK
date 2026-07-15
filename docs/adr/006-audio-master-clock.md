# ADR-006：有声播放由 AudioWorklet 驱动主时钟

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Audio/Player

## Context

视频可以丢帧或重复展示，音频输出不能任意丢块。以 requestAnimationFrame 为主时钟会把 UI 调度抖动带入音频。

## Decision

有声播放使用 AudioContext/AudioWorklet clock 为主时钟，视频调度追随；无声或暂停预览可使用单调时钟。PCM 通过有界 ring buffer 供给，隔离模式优先 SharedArrayBuffer。

## Alternatives

- requestAnimationFrame 主时钟：拒绝用于有声播放；
- HTMLMediaElement 主时钟：不作为精确多轨内核；
- Worker wall clock：无法直接代表音频硬件消费进度。

## Consequences

需要 interruption、underrun、seek flush 和非隔离 fallback 契约。

## Evidence

- `SharedPcmRingBuffer` 使用固定容量 SAB，10 分钟等价 48 kHz/128-frame quantum 压力测试为 0 underrun；
- 真实 Chrome AudioWorklet 消费 ring，AudioContext 时钟推进、pause 和 dispose/close 已通过；
- MP4/AAC 与 WebM/Opus 已规范化为 `f32` PCM，Render IR 音频区间使用与视频相同的整数微秒时间基准；
- `AudioDrivenVideoScheduler` 由音频 clock 选择视频帧，seek generation 丢弃旧结果；pause/resume/seek/interruption 状态契约已测试；
- 非 cross-origin-isolated 环境使用有界、需 acknowledgement 的 Transferable PCM queue；
- 10 分钟等价 PCM 使用固定 32.8 KiB ring，0 underrun，heap 无线性增长；
- 30 秒导出使用同一时间基准，视频/音频尾差 333 μs；Safari/iOS 的真机 interruption 恢复进入 Phase 1，不属于 Phase 0 认证范围。
