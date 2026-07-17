---
title: Material 创作与接入
description: 创建和接入 Filter、Transition、Effect 与 Generator。
---

Material 是 AelionSDK 的视觉扩展单元。Filter、Transition、Effect 和 Generator 使用同一套包、参数、资源、Graph 和执行协议。

## 四层模型

```text
Package → Definition → Graph → Instance
```

- **Package**：可分发内容，包含 manifest、definition、graph、资源、integrity 和可选签名。
- **Definition**：kind、端口、参数、资源槽、能力要求和展示信息。
- **Graph**：由 typed Core Node 组成的有向无环执行图。
- **Instance**：Project 中的版本锁定引用、参数、资源绑定和启用状态。

完整字段和执行语义见 [Material Protocol v1](../../reference/material-protocol-v1/)。

## 创作一个声明式 Material

```ts
import { MaterialAuthoringSession } from '@aelion/material-sdk';

const authoring = new MaterialAuthoringSession();
const graph = authoring.graph('cross-dissolve');

const from = graph.input('from', 'texture2d');
const to = graph.input('to', 'texture2d');
const progress = graph.parameter('progress', 'float');
const color = graph.node('mix', { a: from, b: to, t: progress });

graph.output('color', color);

const result = authoring.build({
  definition: {
    id: 'com.example.cross-dissolve',
    version: '1.0.0',
    kind: 'transition',
    display: { name: 'Cross Dissolve' },
  },
  graph,
});
```

仓库中的可运行示例位于 [`examples/materials`](https://github.com/FoyonaCZY/AelionSDK/tree/main/examples/materials)。Authoring API 的精确类型以 `@aelion/material-sdk` 导出为准。

## 推荐工作流

1. 选择 `kind` 和宿主 slot，定义输入、输出和降级策略。
2. 定义 typed parameters、resource slots、默认值和边界。
3. 只使用已注册 Core Node 构建 Graph。
4. 运行 Schema、类型、拓扑、pass/texture budget 和 backend lint。
5. 用固定输入验证 Preview/Export parity 和 Golden。
6. 生成 deterministic package、integrity 和 capability requirements。
7. 可选地附加 publisher signature，并在 Catalog 中登记版本、弃用和迁移。
8. 宿主验证 package 后，把 runtime program 注册到 Session；Project 只保存 Instance。

## 宿主注册

Project 引用 `previewPolicy: required` 的 Material 时，宿主必须在 `loadProject()` 前注册对应 runtime program。缺少 executable backend 时，结构合法的 Project 仍会在 Preview/Export 阶段明确拒绝。

不要根据 Project 中的 URL 下载并执行 Shader/WASM。推荐流程是：

```text
fetch package as data
  → verify manifest / integrity / signature / revocation
  → apply host trust policy
  → compile declarative graph or authorize trusted implementation
  → register exact material id + version + integrity
  → load Project instance
```

## Composition 与 Catalog

- Composition 通过 slot、order 和显式输入连接多个 Material。
- 编译器可以在语义等价且预算允许时执行 pass fusion。
- Catalog 记录 immutable version、integrity、publisher、capability、deprecation 和 migration。
- Cache key 必须包含 Graph、资源、参数 schema、backend 和影响输出的执行选项。
- Migration 是纯数据变换，输入输出可 canonical hash 和审计；不能在迁移时执行网络代码。

## Material Lab

`MaterialLabSession` 用于：

- 调整参数、时间和输入 fixture；
- 对比 WebGL2/WebGPU 编译与输出；
- 查看 pass、texture 和 uniform budget；
- 收集有界 GPU timing；
- 运行 Golden diff；
- 导出 deterministic package。

本地启动：

```bash
corepack pnpm dev:lab
```

## 安全模型

声明式不等于无限资源。Graph 仍必须限制 node 数量、pass、纹理、采样、循环等价结构、资源字节和编译时间。

| 内容                    | 默认策略                                               |
| ----------------------- | ------------------------------------------------------ |
| 已知 Core Node Graph    | Schema、类型、拓扑和预算通过后允许                     |
| 外部图片/字体等数据资源 | 按 CORS、MIME、大小、hash 和宿主来源策略处理           |
| Shader                  | 默认拒绝；需要签名、allowlist、CSP、静态检查和独立预算 |
| WASM                    | 默认拒绝；需要签名、allowlist、内存/导入限制和超时策略 |
| 网络访问                | Material runtime 默认无权访问；由宿主在数据层完成      |

签名回答“谁发布了这些 bytes”；execution policy 回答“这些 bytes 能否在当前产品中执行”。两者不能合并成一个开关。

## 发布检查

- definition/graph/instance 均通过当前 Schema；
- package canonical bytes 与 integrity 可复现；
- 参数最小值、最大值、缺省值和异常输入已测试；
- 缺资源、backend 不可用、预算超限和取消返回稳定 diagnostic；
- Preview 与 Export 使用相同 evaluator，并有固定输入 Golden；
- 依赖资源许可证完整；
- trusted implementation 有独立安全评审和可撤销策略。
