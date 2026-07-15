# ADR-005：WebCodecs/WebGPU 优先并按 capability 选择

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Runtime/Compatibility

## Context

浏览器版本不能代表具体 codec config、GPU adapter、Worker、AudioWorklet 或文件输出能力。同一浏览器在不同设备上的组合也不同。

## Decision

- WebCodecs 是首选编解码原语；
- WebGPU 是长期首选图形架构候选，WebGL2/WASM/remote 是显式候选；Phase 0 的 1080p30 实时默认按实测选择 WebGL2，WebGPU 在完成持久 device/pipeline 与零拷贝后重评；
- 所有选择基于配置级 probe；
- CapabilityReport、Preflight 和 Diagnostic 在执行前解释支持、降级或拒绝；
- 不根据 user agent 直接承诺能力。

## Alternatives

- 固定浏览器版本矩阵：拒绝，无法覆盖硬件与配置差异；
- 多个 video 元素作为内核：拒绝，精确时间、离线一致性与资源控制不足；
- FFmpeg/WASM 作为唯一内核：拒绝，实时成本和 GPU 拷贝过高。

## Consequences

接入方必须处理能力分级；测试需要真实浏览器和固定配置报告。

## Evidence

- `packages/capability` 对 8 个 codec config、WebGPU/WebGL2、Worker、Audio、OPFS 等做真实探测；
- Chromium 149 为 Tier A，Firefox 140 为 Tier B；浏览器 suite 分别为 38/38、35/35；
- WebGL2 Warm Film 为 51.09 fps，WebGPU 为 27.83 fps；实时默认范围由 ADR-011 冻结；
- WebKit 运行环境阻塞被记录为未认证，不推断 Safari 支持；
- apps/capability-lab 可展示和下载报告。
