# Production Core Evidence Index

> 源码窗口：2026-07-15。本文记录本地可重复门禁；不声明 npm publish 或新增平台认证。

## 结果

| 门禁 | 当前结果 |
|---|---|
| `corepack pnpm test` | 29 files / 274 tests；Vite production/dev server；21 evidence-script tests |
| `corepack pnpm test:browser` | Chromium 10 files / 64 tests |
| `corepack pnpm test:browser:firefox` | Firefox 8 files / 59 tests |
| `corepack pnpm test:golden` | 1/1 |
| `corepack pnpm report:performance` | validated report written |

性能产物：[performance-1080p30-chromium.json](../../reports/baseline/performance-1080p30-chromium.json)。当前报告包含：

- 1080p Warm Film WebGL2/WebGPU、四 pass Soft Glow 与 3840×2160 Warm Film 三帧 probe；
- WebM Export Worker 150 video frames / 240,000 audio frames、sink 最大并发写 `1`、稳态主线程 >50 ms Long Task 为 `0`；
- 10 分钟等价 PCM：played 28,800,000 frames、固定 buffer 32,800 bytes、10 个逐分钟 heap sample 未线性增长；
- compositor dispose 后 pending/active/cancelled request 为 0。

4K probe 记录吞吐和 warm-up p95，但不设 4K30 Tier 门槛，因此只能证明有界离线执行，不能推断实时认证。

## 覆盖映射

- 专业编辑：`packages/transaction/test/commands.test.ts`
- TimeMap/automation/nested sequence：`packages/render-ir/test/time-map.test.ts`、`compiler.test.ts`
- Text/Caption/color：`packages/render-ir/test/text-caption.test.ts`、`color.test.ts`
- blend/mask/generator/adjustment：`packages/renderer-worker/test/ir-renderer.browser.test.ts`
- 音频：`packages/audio/test/ir-mixer.test.ts`、`processing.test.ts`、`device-state.test.ts`
- Export profiles/Worker/Remote/checkpoint：`packages/export/test/*.test.ts`、`packages/sdk/test/session.test.ts`
- Cache/proxy/governor：`packages/media/test/cache-proxy.test.ts`、`resource-governor.test.ts`
- Material trust/migration/composition/Lab：`packages/material-sdk/test/material-production.test.ts`

## 重跑

```bash
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:golden
corepack pnpm report:performance
```

`ci` 还包含 format/schema/lint/typecheck/build/API snapshot。Goal 完成审计只接受全部命令返回 0 的同一源码状态。
