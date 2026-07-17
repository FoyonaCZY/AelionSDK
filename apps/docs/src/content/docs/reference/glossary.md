---
title: 术语表
description: 用简短中文解释 AelionSDK 中常见的 Project、Timeline、Provider、Render IR、Material 和 Export 术语。
---

## 工程和时间线

**Project（工程）**：可以保存和校验的 JSON。记录素材 ID、Sequence、轨道、片段、效果等，不含真实媒体字节和运行时对象。

**Sequence（序列）**：一条可以执行和导出的时间线，定义画布、帧率、音频格式、时长和轨道顺序。

**Track（轨道）**：visual、audio 或 caption 容器，持有有序 Item ID，并有 enabled/locked 和可选音频混音状态。

**Item / Clip（片段）**：占据时间线范围的内容实体。产品界面常叫 Clip，Schema 使用 Item。

**Asset（素材记录）**：Project 中对视频、音频、图片、字体、LUT 或 binary 的稳定描述。Asset 不是 File 本身。

**Marker（标记）**：属于 Sequence 或 Item 的时间锚点，可带 label、color 和业务 payload。默认不参与成片。

**Link Group（联动组）**：需要一起编辑的一组 Item。`av-sync` 用于同一素材的音视频，`edit-group` 用于产品定义的组合。

## 时间

**Timeline time（时间线时间）**：内容在 Sequence 中出现的微秒时间。

**Source time（素材时间）**：内容在原文件中的展示时间。

**TimeMap（时间映射）**：把时间线时间换成素材时间，表达速度、反向、冻结和边界行为。

**半开区间**：范围 `[startUs, startUs + durationUs)`，包含起点、不包含结束边界。

## 编辑

**Transaction（事务）**：一组要么全部成功、要么全部失败的 Project 修改。

**Revision（版本）**：Session 中每次成功提交后的 bigint 版本，用于检测旧快照冲突；不是 Project JSON 字段。

**ChangeSet（变更集）**：一次提交的 operations、受影响实体和时间范围。

**Interactive Edit（交互编辑）**：用于拖拽和滑块：中间可以多次更新，最终只留一条 Undo 记录。

## 执行和预览

**Session**：应用使用的引擎实例。加载 Project 后提供 Transaction、Preview、Player、Export、事件和诊断。

**Render IR**  
Project 编译出的内部执行图。预览、播放和导出共用它；应用不直接保存或编辑。

**Preview（预览）**：指定时间点的单帧求值，可以使用 proxy 和较低 render scale。

**Player（播放器）**：实时播放运行时。有声音时由 AudioWorklet 的 PCM 消费进度驱动视频。

**Scrub（拖动预览）**：拖动播放头时不断请求最新时间点的单帧；旧请求应被新请求取代。

## 媒体

**Media Provider**  
把 Project 的 Asset ID 映射到 File、URL、OPFS、视频帧和 PCM 的运行时对象。

**Representation（表示）**：同一 Asset 的 original、proxy、thumbnail 或 waveform 版本。

**SampleIndex**  
从媒体容器得到的轨、sample、展示顺序、解码顺序和 seek 信息，不是解码帧缓存。

**Proxy（代理素材）**：与原片时间对齐、分辨率较低的预览文件。导出仍使用 original。

## Material 和导出

**Material**  
Filter、Effect、Transition 或 Generator 的版本化扩展定义。

**Core Graph**  
由标准、带类型节点组成的声明式 Material 有向无环图。

**Capability Probe（能力探测）**：对当前页面的 GPU、codec、音频、存储等环境能力生成报告。

**Preflight（启动前检查）**：在具体导出前，检查当前 revision、Project、profile、codec、色彩、Material 和 Sink。

**Profile（导出格式配置）**：稳定输出 ID，例如 `mp4-h264-aac` 或 `audio-wav`。

**Sink（写入目标）**：接收带 position 字节块的 WritableStream，例如内存或 OPFS 文件。

**Remote Export Provider**  
把冻结 Project 和鉴权接到业务渲染服务的适配器。

**Diagnostic（诊断）**：带稳定 code、severity、recoverable 和结构化上下文的错误或警告。业务逻辑依赖 code，不解析 message。
