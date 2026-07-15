# Aelion Visual Core Node Math 1.0.0

本规范绑定 `aelion.visual.nodes/1.0.0`。除特别说明外，颜色输入是线性、premultiplied RGBA 的 `vec4`，标量使用 32-bit GPU float；WebGL2 与 WebGPU 必须使用同一公式。

## 数学与时间节点

| Node | 结果 |
|---|---|
| `math.add` | `a + b` |
| `math.subtract` | `a - b` |
| `math.multiply` | `a × b` |
| `math.divide` | `a / b`；调用方不得提供零分母 |
| `math.clamp` | `min(max(value, min), max)` |
| `math.smoothstep` | 令 `t=clamp((x-edge0)/(edge1-edge0),0,1)`，结果 `t²(3-2t)`；两 edge 不得相等 |
| `time.transition-curve(linear)` | `clamp(progress,0,1)` |
| `time.transition-curve(smooth)` | `smoothstep(0,1,clamp(progress,0,1))` |

非有限 uniform、非法 specialization 和未知 node/typeVersion 必须在 compiler/runtime 边界拒绝。

## 颜色与合成节点

令输入颜色为 `c=(rgb,a)`：

| Node | 结果 |
|---|---|
| `composite.mix` | `mix(a,b,clamp(amount,0,1))` |
| `color.temperature` | `max(rgb × (1+t, 1+0.15t, 1-0.55t),0)`，alpha 不变 |
| `color.lift-black` | `mix(rgb,1,clamp(amount,0,1))`，alpha 不变 |
| `color.scale-rgb` | `max(rgb × scale,0)`，alpha 不变 |
| `color.exposure` | `color.scale-rgb(c, 2^stops)` |
| `color.contrast` | `(rgb-0.5)×amount+0.5`，alpha 不变 |
| `color.saturation` | `mix(luma,rgb,amount)`，`luma=dot(rgb,(0.2126,0.7152,0.0722))` |
| `color.invert` | `(a-rgb,a)`，保持 premultiplied 范围 |
| `composite.screen` | `1-(1-base.rgb)(1-overlay.rgb)`；alpha `ab+ao-ab×ao` |
| `composite.multiply` | `(base.rgb×overlay.rgb, base.a×overlay.a)` |
| `composite.add` | `min(base+overlay,1)` |

`color.extract-highlights → blur.gaussian → color.scale-rgb → composite.screen` 是受支持的四 pass Soft Glow pattern。Highlight 使用 `max(rgb-threshold,0)`；Gaussian radius clamp 到 `[0,64]`，横/纵 pass 使用相同离散 kernel 与边缘 clamp。

## 容差与 Golden

- 同 backend、同 shader、同输入的 8-bit deterministic output：每 channel 绝对误差 `≤1`。
- WebGL2/WebGPU 8-bit cross-backend：每 channel `≤2`，alpha 同样计入。
- `compareMaterialGolden()` 默认容差为 `2`，报告 differing values、maximum error 与 mean error；尺寸不同必须直接拒绝。
- transition Golden 至少覆盖 progress `0/0.25/0.5/0.75/1`；0 和 1 必须保持端点 identity。
- PQ/HLG、10-bit 和 float HDR 不使用本表的 8-bit tolerance；当前本地 pipeline 会 fail closed，待独立 HDR corpus 后再增加规范。

Compiler 的 node registry 是可执行真源；修改公式、端口、alpha 行为或 tolerance 都必须升级 node set/typeVersion，并更新双后端 Golden。
