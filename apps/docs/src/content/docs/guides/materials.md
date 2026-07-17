---
title: 创建和安装 Material
description: 用真实的 Material SDK builder 创建转场，分析 Graph，打包并在宿主中执行信任检查。
---

Material 用来扩展画面处理，包括 Filter、Effect、Transition 和 Generator。如果只是在产品里使用已有素材和效果，可以先跳过本页；只有要制作自己的效果包或 Material 商店时才需要 `@aelion/material-sdk`。

## 四个对象分别做什么

| 对象       | 存在哪里                    | 用途                                                         |
| ---------- | --------------------------- | ------------------------------------------------------------ |
| Package    | `.aelionmat` 文件或二进制包 | 分发一个发布者的一组 Material 和资源                         |
| Definition | Package 内                  | 声明种类、端口、参数、资源、执行限制和实现                   |
| Graph      | Package 内                  | 用标准 Core Node 组成实际画面处理步骤                        |
| Instance   | Project 内                  | 引用精确 package/version/integrity，并保存本次参数和资源绑定 |

同一个 Definition 可以在一个 Project 中创建多次 Instance，每次参数互不影响。Project 不直接携带 Shader/WASM 代码。

## 创建一个 Cross Dissolve 转场

下面代码来自仓库的可运行示例 [`examples/materials/authoring-sdk/cross-dissolve.ts`](https://github.com/FoyonaCZY/AelionSDK/blob/main/examples/materials/authoring-sdk/cross-dissolve.ts)：

```ts
import {
  MaterialRegistry,
  materialDefinition,
  materialGraph,
  packMaterialPackage,
} from '@aelion/material-sdk';

const graph = materialGraph(g => {
  const eased = g.transitionCurve(
    'easedProgress',
    g.systemFloat('transitionProgress'),
    g.parameterEnum('curve'),
  );

  const result = g.mix('mixFrames', g.inputFrame('from'), g.inputFrame('to'), eased);

  g.output('result', result);
});

const material = materialDefinition({
  id: 'cross-dissolve-authored',
  kind: 'visual-transition',
  display: {
    name: 'Cross Dissolve Authored',
    category: 'transition',
  },
})
  .enumParameter('curve', {
    default: 'smooth',
    values: ['linear', 'smooth'],
    affects: 'specialization',
  })
  .graph('graphs/cross-dissolve-authored.graph.json', graph)
  .build();
```

Graph 有两个宿主输入 `from` 和 `to`。系统提供 `transitionProgress`，`transitionCurve` 根据参数把进度变成 linear 或 smooth，`mix` 再合成两帧。

Node ID（如 `easedProgress`）在 Graph 内必须唯一。参数 ID 必须先在 Definition 中声明，Graph 才能通过 `parameterEnum()` 或 `parameterFloat()` 引用。

## 打包

```ts
const packed = await packMaterialPackage({
  metadata: {
    id: 'dev.example.transitions',
    version: '1.0.0',
    displayName: 'Example Transitions',
    publisher: { id: 'dev.example', name: 'Example Publisher' },
    license: 'MIT',
    engines: {
      aelion: '>=0.1.0 <1.0.0',
      nodeSet: 'aelion.visual.nodes/1.0.0',
    },
    trust: 'declarative',
  },
  materials: [material],
});

console.log(packed.integrity);
```

Pack 工具会生成 canonical manifest、逐文件 hash 和 package integrity。同一输入应该得到相同结果。修改 Graph、Definition 或资源后必须重新 pack，不能手改 JSON 后沿用旧 hash。

## 安装并验证完整性

```ts
const registry = new MaterialRegistry();

await registry.install(packed, {
  expectedIntegrity: packed.integrity,
});

const resolved = await registry.resolveMaterial({
  packageId: packed.manifest.package.id,
  packageVersion: packed.manifest.package.version,
  packageIntegrity: packed.integrity,
  materialId: material.definition.id,
});

console.log(resolved.definition.display.name);
```

安装时会检查包大小、路径、manifest、hash、Definition、Graph、类型、拓扑和预算。`expectedIntegrity` 应来自受信任的 Catalog 或服务端记录，而不是和 package 一起从同一个不可信来源读取后原样相信。

## 在 Material Lab 中分析

```ts
import { MaterialLabSession } from '@aelion/material-sdk';

const lab = new MaterialLabSession(material);
lab.setParameter('curve', 'smooth');
lab.setTime(500_000);

const report = lab.analyze();
console.log(report.diagnostics);
console.log(report.budget);
console.log(report.webgl2.available, report.webgpu.available);
```

Report 会给出 node、depth、pass、纹理采样和中间纹理预算，以及 WebGL2/WebGPU 编译是否可用。构建 Material 编辑器时，可以把这些信息放进作者调试面板。

仓库内还有三个静态示例：cross-dissolve、warm-film 和 soft-glow。运行校验：

```bash
node scripts/validate-material-examples.mjs
```

## 怎样进入 Project 和 Session

Project 中保存 Material Instance，它引用精确的 package ID、version、integrity 和 material ID，并持有参数值。打开 Project 时宿主需要：

1. 从可信 Catalog 找到精确 package；
2. 校验大小、integrity、签名和撤销状态；
3. 对声明式 Graph 执行编译，对 trusted code 检查额外授权；
4. 把编译后的 runtime program 注册到 `RuntimeMaterialRegistry`；
5. 创建 Session 时传入 `materials` registry；
6. 再调用 `loadProject()`。

低层注册使用精确的 `IrMaterialDefinition` 和 `WebGl2MaterialProgram`。普通产品不应从 Project 中取一个 URL 后直接下载执行；Package Catalog 和 runtime program 的适配层应由宿主集中管理。

## Filter、Effect、Transition、Generator 怎么选

| kind                | 输入                   | 适合什么                                       |
| ------------------- | ---------------------- | ---------------------------------------------- |
| `visual-filter`     | 一个 source            | 逐像素调色、LUT、颗粒等不改变边界的处理        |
| `visual-effect`     | 可选 source 和辅助输入 | 模糊、光效、位移、多 pass 和需要空间扩边的处理 |
| `visual-transition` | `from` + `to`          | 两个片段之间的过渡                             |
| `visual-generator`  | 没有主输入             | 纯色、渐变和程序背景                           |

不要为了名称好听把多 pass 模糊声明成 filter。Kind 会影响宿主端口、优化和执行限制。

## Trusted Shader/WASM

声明式 Graph 是默认安全路径。Definition 含 Shader 或 WASM 时，Package 必须标记 trusted-code，安装还要显式允许发布者：

```ts
await registry.install(packedTrustedPackage, {
  expectedIntegrity,
  authorizeTrustedCode: true,
  trustedPublisherIds: new Set(['com.example.publisher']),
});
```

签名不自动授予执行权限。宿主还要限制 CSP、内存、导入、运行时间、网络和租户范围，并能撤销发布者或具体版本。

## 发布前检查

- Definition、Graph 和 Package 校验通过；
- 参数默认值、范围、动画方式和异常输入有测试；
- WebGL2/WebGPU 编译结果和预算符合目标设备；
- 固定输入的 Preview/Export Golden 通过；
- 缺资源、backend 不可用、取消和预算超限返回稳定错误；
- package bytes 和 integrity 可复现；
- 图片、字体、LUT 和代码许可证完整；
- trusted implementation 有独立安全评审和撤销策略。

完整字段定义见 [Material Protocol v1](/AelionSDK/reference/material-protocol-v1/)，Core Node 数学见 [Core Node Math](/AelionSDK/reference/core-node-math-v1/)。
