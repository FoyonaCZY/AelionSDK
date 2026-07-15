# ADR-011：Phase 0 认证范围与性能降级

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Runtime/Compatibility

## Context

Phase 0 的目标是验证 browser-first 内核，不是对所有浏览器、设备、codec 和效果做发布承诺。实测显示 Chromium 与 Firefox 能跑通关键链路，但 backend/codec 组合不同；系统 Safari 18.6 因 Remote Automation 未开启无法产出产品级报告，Playwright WebKit 26.0 又在全部下载镜像中断。1080p30 数据也表明当前 WebGPU 路径受每帧 device/readback 开销影响，WebGL2 单 pass 更适合作为实时基线，Soft Glow 四 pass 只能降级。

## Decision

Phase 0 认证范围冻结为：

- 桌面 Chromium 149：Tier A；
- 桌面 Firefox 140：Tier B；
- Safari、iOS Safari、Android 真机：Phase 0 不认证，不推断支持；Capability/Preflight 必须返回未认证或具体不支持原因；
- P0 输入：MP4/H.264/AAC 与 WebM/VP9/Opus；
- P0 本地输出：WebM/VP9/Opus；H.264/AAC 输出只按配置探测，不作统一承诺；
- 实时 1080p30 基线：单 pass declarative Material 走 WebGL2；WebGPU 保留实验主路径候选，Phase 1 完成持久 device/pipeline 和零拷贝呈现后重新评审；
- Soft Glow 四 pass：离线完整执行；实时预览默认降分辨率或按 `skippable-when-degraded` 跳过并报告；
- 颜色范围：SDR、8-bit、工作线性空间；HDR/P3 不认证；
- 项目规模：模板短视频与最长约 10 分钟时间线；长视频、移动端本地导出不认证；
- trusted Shader/WASM 仅限宿主 allowlist 明确授权；动态网络代码默认拒绝；
- 跨 backend 确定性采用节点级视觉/数值容差，不承诺文件逐字节一致。

## Alternatives

- 等待 Safari/移动端全部验证后才接受浏览器内核：拒绝作为 Phase 0 范围；会把已验证架构与产品认证混为一谈；
- 宣称所有 capability 存在的浏览器均受支持：拒绝；配置支持不等于链路验证；
- 坚持 WebGPU 为实时默认：暂缓；当前参考机 Warm Film 约 28.5 fps，WebGL2 约 37.6 fps；
- 在缺失 H.264/AAC 时自动改输出格式：拒绝；Preflight 必须让上层显式选择 WebM、RemoteExport 或拒绝。

## Consequences

- Phase 0 的“支持”仅表示冻结环境与 corpus 上通过自动证据，不是公开 SLA；
- Safari/移动认证成为 Phase 1 P0 工作，不能由 WebKit 或 UA 推断替代；
- 业务若首发必须支持 iOS Safari，Phase 1 发布门禁必须先完成真机矩阵；
- WebGPU 性能不达候选 SLO 不推翻 Render IR/Graph 架构，但阻止其成为当前默认实时 backend；
- 5 秒 1080p30 导出出现一次 102 ms 主线程 Long Task，Phase 1 必须把 frame production/encoder orchestration 继续迁离主线程；Phase 0 只接受离线导出结果与有界资源，不把该数据转为 SLA。

## Evidence

- Chromium：`reports/baseline/capability-chromium.json`、38/38 browser smoke；
- Firefox：`reports/baseline/capability-firefox.json`、35/35 browser smoke；
- WebKit：`reports/baseline/capability-webkit.json` 记录运行时下载 blocker；
- 系统 Safari 18.6：SafariDriver 返回 Remote Automation 未开启；
- `reports/baseline/performance-1080p30-chromium.json`；
- `reports/baseline/media-seek-chromium.json`；
- `reports/baseline/vertical-slice-30s.json`。
