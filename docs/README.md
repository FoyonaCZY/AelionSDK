# AelionSDK 文档

这里是 AelionSDK 的现行文档。内容按使用场景组织，不再按研发阶段堆叠。

## 从哪里开始

| 你想做什么                 | 阅读                                        |
| -------------------------- | ------------------------------------------- |
| 第一次接入 SDK             | [快速开始](getting-started.md)              |
| 了解 SDK 能做什么          | [能力全景](capabilities.md)                 |
| 设计宿主应用或排查模块边界 | [架构设计](architecture.md)                 |
| 创作或接入滤镜、转场和特效 | [Material 创作](materials.md)               |
| 判断浏览器、格式和部署条件 | [兼容性与部署](compatibility.md)            |
| 参与开发、测试或发布       | [开发与发布](development.md)                |
| 查看当前成熟度和验证证据   | [项目状态](status.md)                       |
| 运行完整的上层剪辑 UI      | [参考编辑器](../apps/editor-demo/README.md) |

## Reference

- [Diagnostic Codes](reference/diagnostic-codes.md)：稳定错误码、严重级别与恢复建议。
- [Core Node Math 1.0](reference/core-node-math-v1.md)：Material Core Node 的数学语义与 Golden 容差。
- [Aelion Material Protocol v1](Aelion-Material-Protocol-v1.md)：Material Package、Definition、Graph、Instance 和安全协议。
- [SDK API Snapshot](../packages/sdk/api-snapshot.md)：`@aelion/sdk` 当前公开声明快照。
- [Project v1 Schema](../schemas/project/v1/project.schema.json)：Project 持久化协议的机器可读真相源。

## 文档维护原则

- README 负责产品定位和最短路径，不承载测试流水账。
- Guide 解释如何完成任务；Reference 精确定义协议和错误。
- 当前能力只维护一份结论，兼容性以 [compatibility.md](compatibility.md) 为准。
- 测试数据和生成命令放在 [reports/baseline](../reports/baseline/README.md)，不复制进多篇文档。
- 已完成的 Goal、Backlog 和 Exit Review 保留在 Git 历史，不作为现行产品文档继续维护。
