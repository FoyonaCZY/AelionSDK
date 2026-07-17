# Aelion Material 示例

本目录包含 AMP v1 的三个声明式示例：

- `cross-dissolve/`：双输入视觉转场。
- `warm-film/`：单输入视觉滤镜。
- `soft-glow/`：包含参数化空间扩边的视觉特效。

每个示例都包含：

```text
manifest.json
materials/<id>.material.json
graphs/<id>.graph.json
```

Manifest 中的 `bytes` 和 `sha256` 对 Graph/Definition 当前文件内容有效。修改 payload 后必须由正式 pack 工具重新生成，不能手工保留旧值。

三个示例已由 `@aelion/material-compiler` 编译并进入 WebGL2/WebGPU、Render IR、Golden 与
30 秒垂直导出链路，不再只是协议草图。上层作者还可以使用
`@aelion/material-sdk` 的 typed builder 创建 Definition/Graph，经同一个 Core Node compiler
校验后生成 canonical manifest、逐文件 SHA-256 和 package integrity；完整代码见
[`authoring-sdk/cross-dissolve.ts`](authoring-sdk/cross-dissolve.ts)。
完整创作、打包、精确解析、trusted-code 和宿主接入流程见
[`Material 创作与接入`](../../apps/docs/src/content/docs/guides/materials.md)。

可以运行结构和语义检查：

```bash
node scripts/validate-material-examples.mjs
```

该脚本检查仓库内静态示例的包文件哈希、身份、端口、参数/资源/节点引用和 Graph 环。
Authoring SDK 另外复用运行时 Core Node compiler 做节点端口类型、DAG 与静态预算校验，并由
`MaterialRegistry` 在安装前复核包完整性和 trusted-code 授权；两类门禁互补。
