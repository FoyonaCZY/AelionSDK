# ADR-008：Project 不携带可执行代码

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Security/Material

## Context

若 Project JSON 能直接携带 Shader、WASM 或脚本，打开项目就会跨越代码执行、CSP、供应链和可复现边界。

## Decision

- Project 只保存数据与精确 Material 引用；
- 声明式 Material Graph 是普通作者的默认能力；
- 自定义 WGSL/GLSL/WASM 只能来自宿主已注册的 trusted package/plugin；
- Material 精确锁定 packageId、packageVersion、packageIntegrity、materialId；
- 未安装、未信任或不支持的 Material 不得静默执行或跳过。

## Alternatives

- Project 内嵌 Shader/Lua/WASM：拒绝；
- 任意网络 Material 自动执行：拒绝；
- 完全禁止程序能力：拒绝，会限制高级效果，但必须通过受信注册开放。

## Consequences

需要 Package integrity、权限、预算、signature/allowlist 和 capability diagnostics；声明式 Graph 也必须防止资源耗尽。

## Evidence

- AMP v1 Package/Definition/Graph/Instance 协议；
- 三个示例包与 integrity 校验；
- Project 示例使用统一 materialInstances 和精确 definition lock。
