# MediaProvider 接入契约

`AelionMediaProvider` 把 Project 中稳定的 `assetId + streamIndex + source time` 映射为可渲染视频帧或可混音 PCM。Project locator 负责持久化“资源是什么”，MediaProvider 负责当前会话中“如何获得媒体”，两者不能互相替代。

## 1. 接口

```ts
interface AelionMediaProvider {
  frameAt(
    assetId: string,
    streamIndex: number,
    sourceTimeUs: number,
    signal?: AbortSignal,
  ): Promise<VideoFrame>;

  pcmRange(
    assetId: string,
    streamIndex: number,
    startUs: number,
    durationUs: number,
    signal?: AbortSignal,
  ): Promise<{
    sampleRate: number;
    channelCount: number;
    frameCount: number;
    interleaved: Float32Array;
  }>;
}
```

时间一律是非负安全整数微秒。`streamIndex` 是对应媒体类型的零基 stream index，不是 Project Item 顺序。

## 2. 所有权与正确性

- `frameAt` 每次返回一个仍处于 open 状态、可由 SDK 独占的 `VideoFrame`。Promise 成功后所有权转给 SDK；SDK 可以 transfer/close，Provider 不得再次使用；
- Provider 若从自己的 decoder/cache 得到共享帧，应返回 `frame.clone()`，不能交出仍由 cache 持有的原对象；
- Promise reject 时 Provider 必须关闭本次调用已经创建但未交出的 frame/decoder 资源；
- `pcmRange` 返回的 `Float32Array` 在 Promise resolve 后至少在本次 mixer 读取期间保持不变。SDK 不接管其底层 buffer，也不会要求调用方 `close()`；
- PCM `sampleRate` 必须等于 Sequence sample rate；Alpha mixer 不在此边界隐式重采样；mono/stereo 会由 mixer 映射到目标 channel；
- Provider 只读取 SDK 请求的源范围。`boundary: loop` 等 time-mapping 由 Render IR/audio mixer 拆分成合法的 sourceRange 请求，Provider 不应自行猜测 Item 循环；
- 同一 asset 可能并发收到 preview、player 和 export 请求，Provider 必须可重入，或在内部做有界串行化；
- 收到 abort 后尽快停止 fetch/decode 并 reject。不得把取消后的帧写回可见 cache 或回调。

## 3. 小工程：ByteMediaProvider

`ByteMediaProvider` 适合 Alpha 示例、用户本地小文件或已完整下载的短媒体：

```ts
import { ByteMediaProvider } from '@aelion/sdk';

const bindings = new Map<string, string>([
  ['asset_opening', '/media/opening.mp4'],
  ['asset_closing', '/media/closing.webm'],
  ['asset_music', '/media/music.webm'],
]);

const media = new ByteMediaProvider({
  maxCachedBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
  resolveAssetBytes: async (assetId, signal) => {
    const url = bindings.get(assetId);
    if (url === undefined) throw new ReferenceError(`Unknown asset ${assetId}`);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Media fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
});
```

它复制输入 bytes、以有界 LRU 缓存完整资源并复用视频 SampleIndex。相同 asset 的并发 cache miss 和 SampleIndex 创建会 single-flight；bytes 加载、SampleIndex 创建和 video/audio decode 共用默认 4 路硬并发预算，底层等待队列默认最多 64 个。公开 `frameAt`/`pcmRange` 从进入到 settle 也有独立的总准入上限，等于 `maxConcurrentOperations + maxPendingOperations`（默认 68），所以大量调用复用同一个 hung single-flight 也不能绕过边界。可用 `maxConcurrentOperations` / `maxPendingOperations` 调整；把后者设为 `0` 可启用无等待 fail-fast。旧的 `maxConcurrentLoads` 仍是同一全局并发预算的兼容别名。

每个共享操作使用内部 `AbortController` 和可删除的 subscriber registry：一个调用者取消只停止自己的等待，不影响仍存活的调用者；最后一个调用者取消时会取消底层 resolver/index，已取消 subscriber 与排队任务都会立即移除。队列满时新请求以 `MEDIA_PROVIDER_QUEUE_FULL` fail closed。Resolver、index 与 decoder 必须协作响应收到的 `AbortSignal`；JS 无法强制终止忽略 signal 的宿主 Promise，且 Provider 不会为了伪造“已清理”而提前释放仍在运行的并发 permit。`clear()` 后仍有调用者的旧加载可以完成其原调用，但不会把旧 bytes 写回已清空的 cache。Video 与 audio 都按对应媒体类型的零基 `streamIndex` 选轨；不存在、为负数或非安全整数的 video stream index 会以 `RangeError` 拒绝，而不会静默解码首轨。`maxCachedBytes` 是总 cache 上限；单个大于上限的资源不会常驻 cache，但该次调用仍需要完整 bytes，因此它不是大文件/CDN 的内存解决方案。

观察与释放：

```ts
console.log(media.snapshot()); // cache、operation、single-flight 数量与硬上限
media.clear();                 // 由创建 Provider 的调用方执行
```

Session 不拥有注入的 Provider；`session.dispose()` 不会替调用方清空 `ByteMediaProvider`，因为同一个 Provider 可能被多个 Session 共享。

## 4. 大文件与 CDN Provider

长媒体不应先 `arrayBuffer()` 整个文件。实现自定义 Provider 时建议：

- 用 `FetchRangeReader` 或等价 adapter 建立规范化 SampleIndex；
- 按最近 sync sample 做 exact seek，限制 decoder queue 和 GOP decode amplification；
- 以 asset content identity + stream + codec config 作为 index/cache key，不能只用可能变化的 URL；
- 限制并发 fetch、decoder、retained VideoFrame、PCM block 和总 bytes；
- 把 raw DTS/physical byte offset 当作显式 capability，当前默认 adapter 不提供时不得伪造；
- 对 `MEDIA_RANGE_UNSUPPORTED` 决定“允许小文件全量 fallback”还是拒绝，不能静默下载未知大小资源；
- Session dispose 或业务资源解绑后关闭 decoder、取消请求并驱逐只属于该会话的 cache。

## 5. Locator 解析建议

| Project locator | 推荐运行时处理 |
|---|---|
| `runtime-binding` | 由业务 Map/File handle/上传结果绑定，不把临时对象写进 Project |
| `url` | 校验业务 allowlist、鉴权和 CORS；不要执行 URL 指向的代码 |
| `opfs` | 通过已授权的 OPFS 路径读取，处理文件被删除/配额变化 |
| `data` | 仅用于 Schema 限制内的小资源，不用于视频 |

不要让 asset locator 绕过宿主权限体系。用户导入的 File、带时效签名的 URL、云资产 ID 和离线 cache 都应在 Provider/Resolver 中绑定，Project 只保存可迁移的声明。
