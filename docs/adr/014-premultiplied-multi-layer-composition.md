# ADR-014：视觉轨道按 Project 顺序做 premultiplied alpha-over

- 状态：Accepted
- 日期：2026-07-13
- 负责人：Renderer/Render IR

## Context

Phase 0 垂直工程以单一视觉轨道为主，早期 frame renderer 在同一时刻只选择一个顶层结果，无法承载画中画、标题、贴纸或 adjustment 前的基础多层场景。多轨如果在 Preview 和 Export 各写一套排序/混合，又会在半透明边缘、转场期间和禁用轨道上出现可见分叉。

WebGL/WebGPU、Canvas 和浏览器媒体源还可能对 straight/premultiplied alpha 作不同默认处理，因此必须固定内部数学，而不能把“normal blend”交给每个 backend 自行解释。

## Decision

- `Sequence.trackIds` 是从底到顶的轨道顺序；每个启用的 visual Track 按其 `itemIds` 稳定顺序产生当前时刻的 layer；禁用 Track 和 Item 不参与；
- visual source 经过基础 transform/crop/opacity，再依 `materialInstanceIds` 顺序执行 Item Material；所有中间视觉帧进入工作线性空间的 premultiplied alpha 契约；
- normal 合成采用 Porter-Duff source-over：`Cout = Coverlay + Cbase × (1 − Aoverlay)`，`Aout = Aoverlay + Abase × (1 − Aoverlay)`；这里 `C` 已预乘 alpha；
- 同一 Track 上的 Transition 显式消费 from/to 两个 layer，在两个输入原位置中较低的位置生成一个替代 layer；Transition 结果随后与其他视觉轨道继续做同一 alpha-over；
- Preview 与 Export 都调用 `RenderIrFrameRenderer`，不得各自重排或换用不同 alpha 约定；
- WebGL 上传启用 premultiply，渲染 context 使用 premultiplied alpha；跨 backend Golden 允许规定的像素容差，不要求编码文件逐字节一致；
- Alpha 首版只认证 `blendMode: normal` 的执行语义。Schema 中其他 blend mode 是协议保留值，在实现和 Golden 完成前不能宣称已执行；preflight/diagnostic 应避免静默当作 normal。

## Alternatives

- 只渲染最顶层 Item：拒绝；不具备多轨剪辑的基本语义；
- 用 Canvas 2D 作为唯一合成真相：拒绝作为核心路径；难以统一 Material GPU pass 和 Worker 资源预算；
- 内部使用 straight alpha：不采用；重复 filter/scale 时更容易产生半透明边缘色污染，且 Material Protocol 已冻结 premultiplied 契约；
- 按实体 map key 或创建时间排序：拒绝；normalized map 无视觉顺序语义，必须使用显式 ID list。

## Consequences

- Track reorder 是可见的原子编辑，并使受影响区间的 Render IR/缓存失效；
- Material 作者必须声明并遵守 premultiplied input/output；破坏透明度的实现要在 execution contract 中明确；
- Transition 不能作为“全画面最终结果”短路其他轨道；
- 后续 blend mode、mask/matte 和 track/sequence Material 必须在此顺序模型上扩展并增加双 backend Golden。

## Evidence

- `packages/render-ir/src/evaluate.ts`：按 Render IR Track/Clip 顺序选择启用 layer；
- `packages/renderer-worker/src/ir-renderer.ts`：基础视觉 pass、Transition 替换和 builtin premultiplied alpha-over；
- `packages/renderer-worker/test/ir-renderer.browser.test.ts`：真实像素多轨 alpha 合成；
- Chromium 真实像素用例验证 Transition 结果保留在 layer stack，继续与后续 visual Track 合成，并验证 Preview/Export 像素与 Material ID 一致；该用例已进入 Firefox suite，Firefox 最终运行状态以 Phase 1 evidence 索引为准。
