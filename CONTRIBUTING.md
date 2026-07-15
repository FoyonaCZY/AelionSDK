# Contributing to AelionSDK

感谢你帮助改进 AelionSDK。当前项目处于 Alpha 阶段，公开 API 和协议仍可能变化。

## 开始之前

- 对较大的 API、Project/Material 协议或架构改动，请先创建 issue 并达成方向共识。
- 安全问题不要创建公开 issue，请按 [SECURITY.md](SECURITY.md) 私下报告。
- 参与项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 本地开发

需要 Node.js 20.19.x 和仓库锁定的 pnpm 版本：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm run test:pack
corepack pnpm test:browser
corepack pnpm test:browser:firefox
```

涉及公开包、exports、Worker/AudioWorklet 或 SDK facade 的改动还必须运行：

```bash
corepack pnpm test:consumer
corepack pnpm release:dry-run
```

涉及 Project/Player/Preview/Export 集成语义时，按需重新生成 `corepack pnpm report:alpha`，并审查 60 秒独立音视频回读、队列和 dispose 证据。完整流程见 [AelionSDK Development Workflow](docs/AelionSDK-Development-Workflow.md)。

浏览器能力不能根据桌面 Chromium 的结果推断到 Safari、iOS 或 Android。涉及兼容性的变更必须附带真实环境和版本信息。

## 提交要求

- 保持改动聚焦，并为行为变化添加测试。
- 不提交生成的 `dist`、本地报告、凭据或受限制媒体。
- Project/Material 协议变化需提供迁移策略，破坏性决策需新增 ADR。
- 公开 API 变化需更新 declaration snapshot、CHANGELOG 和 [Breaking Change Policy](docs/versioning-and-breaking-changes.md)。
- 依赖或测试素材变化需同步许可证与来源声明。
- PR 描述应包含动机、实现边界、验证命令和兼容性影响。

贡献默认按仓库的 MIT 许可证提供，除非你在提交时明确另行说明。
