# ADR-015：Material Authoring 使用确定性包、精确 integrity 与显式信任

- 状态：Accepted
- 日期：2026-07-13
- 负责人：Material/Security

## Context

上层必须能独立制作滤镜、转场、特效和生成器，而无需修改 Aelion 内核。与此同时，项目文件来自用户或网络，不能因为其中出现一个 URL 就动态执行 Shader、WASM 或 JavaScript。只校验 package 名和版本也无法保证多年后打开项目得到同一 Graph/资源；签名能证明发布者身份，却不等于代码安全或宿主授权。

## Decision

`@aelion/material-sdk` 实现 Aelion Material Protocol 的创作与供应链边界：

- 作者通过 typed Definition/Graph builder 描述 kind、ports、parameters、resources、execution contract、nodes 和 outputs；Graph 在打包前做 DAG、类型、host port 和静态预算校验；
- Package 身份为 `package id + exact version + package integrity`，Material 身份再加 `material id`；Project 不使用 `latest` 或 semver range；
- JSON 使用 key-sorted canonical bytes；每个 payload 记录 SHA-256、字节数和 media type；manifest 自身产生 `sha256:` integrity；
- `.aelionmat` 是文件有序、固定时间戳、store-only 的确定性 ZIP。archive transport 不改变 manifest/payload hash 语义；
- Registry 安装时校验 canonical manifest、expected integrity、所有声明 payload 的 hash/size、无未声明或缺失文件，并按 id/version/integrity 精确存取；
- `trust: declarative` 只允许受限 Core Graph；只要 Definition 引用 Shader/WASM，就必须是 `trusted-code` package；
- trusted-code 同时要求调用方 `authorizeTrustedCode: true` 和 publisher allowlist 命中。签名或 integrity 绝不自动授予执行权限；Project 不得触发网络动态代码加载；
- Worker/WASM 不是安全沙箱。即使已授权，宿主仍应施加 graph/pass/texture/memory/time 预算、CSP 和审计；
- 当前 SDK 完成 SHA-256 完整性与 publisher allowlist。公钥签名链、撤回、Marketplace 审核属于后续能力，不能在 Alpha 文档中冒充已实现。

## Alternatives

- 允许 Project 直接内嵌/引用任意 WGSL、GLSL、WASM：拒绝；供应链、CSP、DoS 和重现性边界不可控；
- 只按 package version 解析：拒绝；相同版本内容可被替换，无法确定性回放；
- “签名即可信代码”：拒绝；签名只回答内容来自谁，不回答宿主是否愿意执行；
- 所有效果硬编码进 SDK：拒绝；无法让上层独立创作和版本化 Material。

## Consequences

- 任何 payload 或 manifest 改动都会改变 hash/integrity；语义变更还必须提升 Material package 版本；
- Registry 解析失败、完整性失败或信任不足必须在编译/执行前拒绝，不得静默降级为另一包；
- declarative Graph 是默认生态路径，Shader/WASM 是受控逃生舱；
- RuntimeMaterialRegistry 只注册已编译程序，不替代 Package Registry 的安装、完整性和授权步骤。

## Evidence

- `packages/material-sdk/src`：builders、validation、canonical pack、deterministic ZIP 与 Registry；
- `packages/material-sdk/test/material-sdk.test.ts`：确定性、篡改、缺失 payload、精确解析和 trusted-code 拒绝；
- `examples/materials/authoring-sdk/cross-dissolve.ts`：外部作者示例；
- [Aelion Material Protocol v1](../Aelion-Material-Protocol-v1.md) 的 Package/Definition/Graph/Instance 与安全规范。

