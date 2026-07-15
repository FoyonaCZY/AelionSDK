# Security policy

## 支持范围

安全修复只面向最新发布版本。`0.x` Alpha 不提供长期支持，升级可能包含 API 变化。

## 私下报告漏洞

请在 [FoyonaCZY/AelionSDK](https://github.com/FoyonaCZY/AelionSDK) 使用 **Security → Report a vulnerability** 私下提交报告，不要创建公开 issue。若该入口尚不可用，请暂缓公开披露，并通过仓库所有者的 GitHub 公开资料联系维护者。

报告请包含受影响版本、复现步骤、影响、可行缓解方式和（如有）最小复现。维护者目标是在 7 天内确认收到，并在确认问题后协调披露时间。

特别关注的边界包括不受信任的 Project/Material/媒体输入、Shader/WASM allowlist、跨源资源、Worker/AudioWorklet、OPFS 及导出写入。不要在报告中附带真实用户媒体、访问令牌或其他敏感数据。
