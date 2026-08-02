---
title: Project Schema 参考
description: 不可变 Schema 身份、迁移、顶层集合、实体关系与加载校验。
---

日常创建工程时优先使用 `createProject()` 或 `createComposition()`。当前机器可读定义是
[`schemas/project/v1.2/project.schema.json`](https://github.com/FoyonaCZY/AelionSDK/blob/main/schemas/project/v1.2/project.schema.json)。

## Schema 身份

| 方言      | `$schema`                                      | `schemaVersion` | 用途                                     |
| --------- | ---------------------------------------------- | --------------- | ---------------------------------------- |
| 旧 v1.0   | `https://schemas.aelion.dev/project/v1.json`   | `1.0.0`         | 1.0 发布后保持不可变的 Schema            |
| 当前 v1.2 | `https://schemas.aelion.dev/project/v1.2.json` | `1.2.0`         | 图像序列、字幕 cue settings 和关键帧手柄 |

1.1/1.2 rc.1 曾错误地用旧身份写入新字段。rc.2 默认校验器会识别这组精确的旧身份，先制作
所有权隔离快照，只修改两个身份字段，再按 v1.2 校验；调用方对象不会被修改。需要持久化升级
结果时调用 `migrateProjectToCurrent(value)`。严格验证原始 v1.0 时可使用
`defaultSchemas.legacyProject`。

## 顶层模型

| 字段                                    | 含义                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| `$schema`、`schemaVersion`、`projectId` | 协议身份与稳定的工程 ID                                            |
| `metadata`、`settings`、`extensions`    | 纯 JSON 的元数据、默认策略和命名空间扩展                           |
| `assets`                                | 持久媒体身份与 representations，不保存 `File`、凭据或 decoder 对象 |
| `sequences`、`tracks`、`items`          | 规范化时间线图和有序所有权引用                                     |
| `materialInstances`、`transitions`      | 效果实例和显式转场范围                                             |
| `markers`、`linkGroups`                 | 时间标记，以及 AV/编辑分组                                         |

集合 key 必须等于实体自身的 `id`。有序 ID 列表不能重复；每个引用都必须解析到归属于正确
Sequence 或 Track 的实体。

## 时间、颜色与媒体

时间线和源时间使用整数微秒，帧率使用有理数。Sequence 定义画布、采样率、声道布局和显式
颜色契约。媒体 Item 用线性或曲线 time map 把 Sequence 时间映射到 Asset stream，并声明
越界策略。

`image-sequence` Asset 包含 `imageSequence.frameDurationUs` 和有序 `frameAssetIds`；每一帧
都必须引用现有 `image` Asset。编译器会把清单复制进不可变 Render IR，预览和导出在每个帧
边界使用相同解析规则。

Caption Item 归属于 caption Track。SRT/WebVTT cue settings 保存为 JSON；高级 ASS 样式目前
不属于 Schema 契约。

## 校验与加载

`loadProject()` 依次执行有界准入、Schema、实体所有权和引用、嵌套 Sequence 环、time map、
转场、mask、Material、音频、颜色与图像序列检查。失败时 Session 保持不变，并返回稳定且
带路径的诊断。旧身份成功迁移时，可从 `ProjectValidationSuccess.migration` 读取记录。
