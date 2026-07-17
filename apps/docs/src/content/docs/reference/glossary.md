---
title: 术语表
description: AelionSDK 文档中 Project、Timeline、IR、Provider、Material 和导出相关术语。
---

**Asset**  
Project 中对媒体、字体、LUT 或 binary 的稳定描述，不等于运行时字节。

**Representation**  
同一 Asset 的 original、proxy、thumbnail 或 waveform 表示。

**Project**  
可序列化、可验证的工程实体图，是持久化边界。

**Sequence**  
一条输出时间线，定义画布、帧率、音频格式、时长和轨道顺序。

**Track**  
visual、audio 或 caption 容器，拥有有序 Item 列表和 enabled/locked/mixer 状态。

**Item / Clip**  
占据 Timeline 范围的内容实体。Clip 是产品语言，Schema 使用 Item。

**Timeline time**  
内容在 Sequence 中出现的微秒时间。

**Source time**  
内容在原素材中的展示时间。

**TimeMap**  
Timeline time 到 Source time 的确定性映射，表达速度、反向和边界。

**Marker**  
属于 Sequence 或 Item 的非渲染时间锚点，带 label/color/payload。

**Link Group**  
定义音视频同步或编辑联动的 Item 集合。

**Transaction**  
一组全成功或全失败的 Project 原子操作。

**Revision**  
Session 中 Project 成功提交后的单调 bigint 版本。

**ChangeSet**  
一次提交的 operations、受影响实体和时间范围。

**Interactive Edit**  
允许多次实时 update、最终合并为一条 undo 记录的拖拽/调参事务。

**Render IR**  
Project 编译得到的确定性渲染中间表示，由 Preview、Player 和 Export 共享。

**Preview**  
指定时间点的单帧求值，可使用 proxy 和降 scale。

**Player**  
由音频时钟驱动、带视频调度和丢帧策略的实时播放运行时。

**Scrub**  
用户拖动播放头时的 latest-wins 单帧预览。

**Media Provider**  
把 Asset ID 映射到 RangeReader、SampleIndex、视频帧和 PCM 的运行时对象。

**SampleIndex**  
从媒体容器得到的轨道、sample、展示顺序和 seek 数据。

**Material**  
Filter、Effect、Transition 或 Generator 的声明式、版本化扩展定义。

**Core Graph**  
由受支持节点和类型连接组成的声明式 Material DAG。

**Capability Probe**  
对环境 GPU、codec、音频、存储等能力的运行时报告。

**Preflight**  
在启动具体导出前，对 frozen revision、Project、profile、codec、色彩和 Sink 的检查。

**Profile**  
稳定的输出格式 ID，如 `mp4-h264-aac`。

**Sink**  
接收带 position 字节块的可 seek WritableStream，例如内存或 OPFS。

**Remote Export Provider**  
把 canonical manifest 和鉴权接到业务渲染服务的宿主适配器。

**Diagnostic**  
带稳定 code、severity、recoverable 和结构化上下文的错误/警告记录。
