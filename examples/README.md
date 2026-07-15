# AelionSDK Project 示例

| 文件                                                                               | 用途                                                                             | 证据状态                                                    |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`aelion-project-v1.example.json`](aelion-project-v1.example.json)                 | Project v1 协议完整示例，包含多 Track、Material、Transition、Marker 与 LinkGroup | ProjectValidator fixture                                    |
| [`aelion-vertical-slice-30s.project.json`](aelion-vertical-slice-30s.project.json) | Phase 0 固定垂直工程                                                             | 已有 30 秒 WebM 与独立回读基线                              |
| [`aelion-alpha-60s.project.json`](aelion-alpha-60s.project.json)                   | Phase 1 公开 SDK 集成工程                                                        | 已有 60 秒 edit/play/preview/export、容器与 FFmpeg 回读证据 |
| [`materials/`](materials/README.md)                                                | Cross Dissolve、Warm Film、Soft Glow 与 Authoring SDK 示例                       | Schema/compiler/Golden fixture                              |

## 60 秒 fixture 的真实性边界

`aelion-alpha-60s.project.json` 保持 Phase 0 的 runtime binding ID：

- `fixture-mp4-opening` → `asset_opening`；
- `fixture-webm-closing` → `asset_closing`；
- `fixture-opus-music` → `asset_music`。

仓库媒体是约 3 秒的短 fixture。Project 通过 `sourceRange.durationUs = 3_000_000` 与 `timeMapping.boundary = "loop"` 显式循环成 60 秒；它不声称源文件本身有 60 秒。opening 覆盖 0–31 秒，closing 覆盖 29–60 秒，`transition_center` 在 29–31 秒执行 Cross Dissolve，audio 覆盖完整 0–60 秒。

该 Project 固定为 320×180、30 fps、48 kHz stereo，以降低可复现集成证据成本。它验证 60 秒调度和资源语义，不代表 1080p、长视频或移动端性能 SLA。

主报告见 [`reports/baseline/alpha-60s.json`](../reports/baseline/alpha-60s.json)。

## Runtime binding

`runtime-binding` 只保存稳定 binding ID，不把 File、签名 URL、token 或 bytes 放入 Project。接入方必须在 MediaProvider 中把 Project `assetId` 解析到当前会话资源，遵守[媒体接入约束](../docs/getting-started.md#3-准备-project-与媒体)。

修改 fixture 后必须：

1. 用 ProjectValidator 校验 Schema、references 和 Material ownership；
2. 更新所有依赖固定 entity ID/time range 的测试/runner；
3. 重新生成对应 evidence，不保留旧 artifact/hash；
4. 明确记录 source、loop、codec、许可和兼容范围变化。
