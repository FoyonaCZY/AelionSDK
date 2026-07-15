# ADR-013：多包发布且以真实 tarball consumer 为分发门禁

- 状态：Accepted
- 日期：2026-07-13
- 负责人：Release/SDK

## Context

Aelion 的 Project、Transaction、Media、Renderer、Audio、Export 和 Material Authoring 有独立的依赖边界。只发布一个巨大 bundle 会迫使所有高级接入方携带不需要的能力，也难以单独测试协议层；但多包 workspace 又很容易出现只在源码 alias 下可用、tarball 残留 `workspace:*`、Worker/AudioWorklet URL 指向 `.ts`、许可证或类型声明缺失等“仓库内绿色、安装后损坏”问题。

## Decision

采用 pnpm workspace 的多包发布策略：

- `@aelion/sdk` 是推荐统一门面；`@aelion/core`、`project-schema`、`transaction`、`media`、`render-ir`、`renderer-worker`、`audio`、`export`、`capability`、`material-compiler` 与 `material-sdk` 是可安装的高级/分层入口；Phase 1 另交付 `@aelion/vite-plugin` 作为 Vite 的公开 Worker/AudioWorklet 资源集成；
- 全部公开包以同一 release train 发布 `0.1.0-alpha.0`，使用 MIT，声明 ESM `exports`、`.d.ts`、`files`、repository metadata 和 public access；
- npm pack 阶段把根 LICENSE 与包 README 放入每个 tarball，不发布 `src`、测试和 `.tsbuildinfo`；
- workspace 依赖在 pack 后必须转换为可安装版本，最终 tarball 不得出现 `workspace:*`；
- `new URL(..., import.meta.url)` 引用的 Worker/AudioWorklet 必须指向并随包包含编译后的 `.js`；不依赖 consumer bundler 猜测 TypeScript 资源。若某 bundler 需要 asset transform，该适配器必须成为公开、版本化、文档化的交付，而不能只存在于仓库测试脚本；
- 发布验证分两层：`test:pack` 在干净目录安装真实 `.tgz`、导入全部入口并检查资产；`test:consumer` 从同样的 tarball 启动真实 Vite consumer，并在认证浏览器实际创建 Worker/AudioWorklet 和最小 Session 链路；
- provenance 配置保留在 manifest，但只有真实受信 CI publish 成功后才能宣称已生成 provenance；本地 pack 不构成证明；
- repository/homepage/bugs 统一指向真实仓库 `github.com/FoyonaCZY/AelionSDK`；变更远端必须同步全部 package metadata 和 consumer gate。

## Alternatives

- 只测试 workspace import：拒绝；它不会发现 pack 重写、文件白名单和 URL 资源问题；
- 只发布 `@aelion/sdk`：暂不采用；Material 作者、协议校验和定制媒体接入需要较小的公开边界；
- 把 Worker/Worklet 内联为字符串：不作为统一策略；会增加 CSP、source map、缓存和调试成本；
- 在包中发布原始 TypeScript 让 consumer 编译：拒绝；不同 bundler 的 worker graph 和 TS 配置不可控。

## Consequences

- 所有包必须维护一致版本和发布 metadata，release CI 成本高于单包；
- 内部包虽然可安装，但稳定性级别仍由 semver policy 与公开 API 快照界定，不能把任意内部文件当公开入口；
- 修改 Worker/Worklet 文件名、exports 或依赖关系必须同时通过 Node tarball smoke 和真实浏览器 consumer；
- consumer 测试必须使用 tarball 路径，不能回退到 workspace alias。

## Evidence

- 13 个公开 `packages/*/package.json`，包括 `@aelion/vite-plugin`；
- `scripts/package-artifacts.mjs` 与 `scripts/test-package-consumer.mjs`；
- 最近一次 `corepack pnpm test:pack` 已验证当前 12 个真实 tarball 的安装、入口、LICENSE/README、依赖和 Worker/Worklet 文件；加入 `@aelion/vite-plugin` 后必须以 13 包结果刷新该证据；
- 浏览器 tarball consumer 的最终状态以 `docs/evidence/phase-1-index.md` 为准，不由本 ADR 提前宣称通过。
