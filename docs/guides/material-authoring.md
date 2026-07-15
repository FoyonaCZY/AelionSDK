# Material Authoring SDK 快速指南

`@aelion/material-sdk` 允许上层独立创作 Filter、Transition、Effect 和 Generator。默认产物是声明式数据包，不是可随 Project 自动执行的任意代码。

## 1. 安装

```bash
pnpm add @aelion/material-sdk @aelion/material-compiler @aelion/sdk
```

四层模型：

1. **Package**：发布者、版本、文件 hash、trust；
2. **Definition**：Material kind、参数、端口、资源和执行契约；
3. **Graph**：typed Core Node DAG；
4. **Instance**：Project 中的精确 package 引用、参数和输入绑定。

## 2. 创建一个 Transition

```ts
import {
  MaterialRegistry,
  materialDefinition,
  materialGraph,
  packMaterialPackage,
} from '@aelion/material-sdk';

const graph = materialGraph(g => {
  const amount = g.transitionCurve(
    'eased-progress',
    g.systemFloat('transitionProgress'),
    g.parameterEnum('curve'),
  );
  const frame = g.mix('mix', g.inputFrame('from'), g.inputFrame('to'), amount);
  g.output('result', frame);
});

const dissolve = materialDefinition({
  id: 'brand-dissolve',
  kind: 'visual-transition',
  display: { name: 'Brand Dissolve', category: 'transition' },
})
  .enumParameter('curve', {
    default: 'smooth',
    values: ['linear', 'smooth'],
    affects: 'specialization',
  })
  .graph('graphs/brand-dissolve.graph.json', graph)
  .build();

const packed = await packMaterialPackage({
  metadata: {
    id: 'com.example.transitions',
    version: '1.0.0',
    displayName: 'Example Transitions',
    publisher: { id: 'com.example', name: 'Example' },
    license: 'MIT',
    engines: {
      aelion: '>=0.1.0 <1.0.0',
      nodeSet: 'aelion.visual.nodes/1.0.0',
    },
    trust: 'declarative',
  },
  materials: [dissolve],
});
```

Builder 自动补全 Transition 的 `from/to/result` host ports；打包前会检查 DAG、节点端口类型、参数和静态预算。`packed.archiveBytes` 是确定性 `.aelionmat` ZIP 内容，`packed.integrity` 是 Project 应锁定的 manifest integrity。

保存文件时使用业务文件 API/下载流程写出 `archiveBytes`；不要 JSON stringify 这个 Uint8Array。

## 3. 安装与精确解析

```ts
const registry = new MaterialRegistry();
await registry.install(packed, { expectedIntegrity: packed.integrity });

const resolved = await registry.resolveMaterial({
  packageId: 'com.example.transitions',
  packageVersion: '1.0.0',
  packageIntegrity: packed.integrity,
  materialId: 'brand-dissolve',
});
```

Registry 同时匹配 id、exact version 与 integrity；相同 id/version 但不同内容不会互相替代。安装会拒绝：

- canonical manifest 或 expected integrity 不一致；
- payload SHA-256/size 不一致；
- 未声明、缺失或危险路径文件；
- Definition/manifest identity 不一致；
- Graph cycle、类型错误、缺 host port 或超预算；
- declarative package 内包含 Shader/WASM。

默认传输边界是：包含根 `manifest.json` 在内最多 256 个文件、单个 payload 32 MiB、canonical manifest 256 KiB、全部文件合计 64 MiB、确定性 ZIP 65 MiB。`packMaterialPackage`、`verifyMaterialPackage` 和 `MaterialRegistry` 使用同一口径；宿主可通过 `limits` 收紧。大小和容器 brand 会在 defensive snapshot、hash 和 ZIP 重建之前检查，`Uint8Array`/`Map` 的伪造对象或 Proxy 不会被当作可信传输容器。

包路径必须是规范 UTF-8 相对路径：不得有绝对路径、反斜杠、NUL、空 segment、`.`/`..` segment 或尾随 `/`；`manifest.json` 与 `signature.json` 是保留名，不能作为普通 payload。当前 Alpha 接口接收已展开的 `PackedMaterialPackage`，不负责解压任意外部 ZIP；接入 ZIP reader 时必须在分配/解压前施加相同 archive、entry、路径与解压后总字节限制。

## 4. 从 Package Registry 接入 Session runtime

`MaterialRegistry` 负责包完整性、信任与精确解析；`RuntimeMaterialRegistry` 负责把已审核 Graph 编译成当前 Session 可执行的 backend。Alpha 当前保留这两个显式阶段，避免 `loadProject` 根据不可信引用自动下载或执行代码：

```ts
import { compileMaterialGraphToWebGl2 } from '@aelion/material-compiler';
import { Aelion, RuntimeMaterialRegistry } from '@aelion/sdk';

if (resolved.graph === undefined) {
  throw new Error('The resolved declarative Material has no Graph payload');
}
const resolvedGraph = resolved.graph;

const runtimeMaterials = new RuntimeMaterialRegistry();
const unregister = runtimeMaterials.register(resolved.reference, parameters =>
  compileMaterialGraphToWebGl2(resolvedGraph, {
    parameters: { curve: 'enum' },
    specializationValues: { curve: parameters.curve ?? 'smooth' },
    inputPorts: { from: 'visual-frame', to: 'visual-frame' },
    systems: { transitionProgress: 'float' },
  }),
);

const session = await Aelion.createSession({ media, materials: runtimeMaterials });
try {
  await session.loadProject(project);
  const frame = await session.preview.renderFrame({ timeUs: 1_000_000 });
  frame.bitmap.close();
} finally {
  await session.dispose();
  unregister();
}
```

示例显式声明 `curve`、`from/to` 和 `transitionProgress`，因为这些是该 Definition/Graph 的已审核编译契约。通用宿主应从验证后的 Definition 生成 parameter/input map，并按 Graph-affecting/specialization 参数缓存 program；不能相信 Project Instance 自报类型。`RuntimeMaterialRegistry` 的 key 仍是 exact package id/version/integrity/material id，另一个 integrity 不会命中现有 program。

Graph 编译成功不替代 Package Registry 安装：宿主顺序必须是 resolve bytes → verify/install trust/integrity → resolve Definition/Graph → compile approved backend → register runtime program → load/render Project。

## 5. Trusted Shader/WASM

自定义程序是显式高权限逃生舱：

```ts
await registry.install(trustedPacked, {
  expectedIntegrity: trustedPacked.integrity,
  authorizeTrustedCode: true,
  trustedPublisherIds: new Set(['com.example.security-reviewed']),
});
```

三个条件缺一不可：manifest 为 `trusted-code`、本次安装显式 `authorizeTrustedCode`、publisher allowlist 命中。Integrity 或未来的签名只证明内容/身份，不授予执行权。

不要：

- 根据 Project 提供的 URL 动态 import JavaScript/WASM/WGSL/GLSL；
- 把“运行在 Worker/WASM”当安全沙箱；
- 为方便接入使用全局 `authorizeTrustedCode: true` 和无限 publisher allowlist；
- 让 trusted code 绕过 pass/texture/memory/time budget 或 CSP。

## 6. 版本规则

- 修改任何 payload 都会改变 SHA-256 与 package integrity；
- 修复实现但保持参数/视觉契约兼容：提升 patch；
- 新增向后兼容参数/Material：提升 minor；
- 删除/重命名参数、改变默认值/数学、端口或 alpha/color/time 语义：提升 major；
- Project 始终固定 exact version + integrity，升级通过 Project Transaction 完成，不原地替换已锁定包；
- 当前 SDK 已实现完整性和 publisher allowlist，尚未实现完整公钥签名/撤回/Marketplace 信任链。

完整协议见 [Aelion Material Protocol v1](../Aelion-Material-Protocol-v1.md)，可运行范例见 [`examples/materials/authoring-sdk/cross-dissolve.ts`](../../examples/materials/authoring-sdk/cross-dissolve.ts)。
