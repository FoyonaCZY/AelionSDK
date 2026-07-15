# ADR-002：公开时间使用整数微秒与有理数帧率

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Time/Model

## Context

浮点秒会在帧边界、吸附、转场和音频采样累计误差；单一帧号无法同时表达 VFR、音频和跨帧率工程。

## Decision

- Project 和公开 API 的时间单位为安全整数微秒；
- 帧率保存为正整数有理数 numerator/denominator；
- 帧边界按 floor(n × 1,000,000 × D / N)；
- 音频采样边界通过相邻有理边界相减；
- 中间乘除使用 BigInt 或等价的受检 64 位整数。

## Alternatives

- 浮点秒：拒绝，边界不稳定；
- 纳秒：拒绝，JavaScript/JSON 安全整数范围和 WebCodecs 对接不佳；
- 帧号：拒绝，不能统一音频与 VFR；
- Flicks：不采用为公开协议，浏览器 API 仍使用微秒。

## Consequences

量化帧边界的逆映射必须按同一 floor 语义求解，不能简单再次除以帧时长。

## Evidence

- packages/core/src/time.ts；
- 24/25/30/50/60、24000/1001、30000/1001、60000/1001 属性测试；
- 44.1/48/96 kHz 采样边界与分块无漂移测试。
