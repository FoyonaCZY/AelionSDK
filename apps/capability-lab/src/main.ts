import { probeCapabilities, type CapabilityProbe, type CapabilityReport } from '@aelion/capability';

import './style.css';

function requireApp(): HTMLElement {
  const element = document.querySelector<HTMLElement>('#app');
  if (element === null) throw new Error('Capability Lab root element is missing');
  return element;
}

const app = requireApp();

function statusLabel(probe: CapabilityProbe): string {
  if (probe.status === 'supported') return '可用';
  if (probe.status === 'degraded') return '受限';
  if (probe.status === 'unknown') return '探测失败';
  return '不可用';
}

function statusCard(label: string, probe: CapabilityProbe): string {
  return `
    <article class="capability-card status-${probe.status}">
      <span class="status-dot" aria-hidden="true"></span>
      <div>
        <h3>${label}</h3>
        <p>${statusLabel(probe)}</p>
      </div>
    </article>
  `;
}

function codecSummary(report: CapabilityReport): string {
  return report.codecs
    .map(
      codec => `
        <tr>
          <td>${codec.id}</td>
          <td><code>${codec.codec}</code></td>
          <td><span class="pill ${codec.supported ? 'supported' : 'unsupported'}">
            ${codec.supported ? '支持' : '不支持'}
          </span></td>
        </tr>
      `,
    )
    .join('');
}

function downloadReport(report: CapabilityReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `aelion-capability-${report.generatedAt.replaceAll(':', '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function render(report: CapabilityReport): void {
  const tier = report.tier.toUpperCase();
  app.innerHTML = `
    <header class="hero">
      <div>
        <p class="eyebrow">AELIONSDK · PHASE 0</p>
        <h1>Capability Lab</h1>
        <p class="subtitle">用真实配置探测当前浏览器的剪辑、合成与导出能力。</p>
      </div>
      <div class="tier-card">
        <span>能力等级</span>
        <strong>${tier}</strong>
      </div>
    </header>

    <section class="environment">
      <div><span>浏览器</span><strong>${report.environment.userAgent}</strong></div>
      <div><span>隔离模式</span><strong>${report.environment.crossOriginIsolated ? '已启用' : '未启用'}</strong></div>
      <div><span>CPU 并发</span><strong>${report.environment.hardwareConcurrency ?? '未知'}</strong></div>
      <div><span>生成时间</span><strong>${new Date(report.generatedAt).toLocaleString()}</strong></div>
    </section>

    <section>
      <div class="section-heading">
        <div>
          <p class="eyebrow">RUNTIME</p>
          <h2>运行时能力</h2>
        </div>
        <button id="download-report" type="button">下载完整报告</button>
      </div>
      <div class="capability-grid">
        ${statusCard('WebGPU', report.gpu.webgpu)}
        ${statusCard('WebGL 2', report.gpu.webgl2)}
        ${statusCard('Worker', report.gpu.worker)}
        ${statusCard('OffscreenCanvas', report.gpu.offscreenCanvas)}
        ${statusCard('AudioWorklet', report.audio.audioWorklet)}
        ${statusCard('SharedArrayBuffer', report.audio.sharedArrayBuffer)}
        ${statusCard('OPFS', report.storage.opfs)}
        ${statusCard('文件输出', report.storage.fileSystemAccess)}
      </div>
    </section>

    <section>
      <div class="section-heading">
        <div>
          <p class="eyebrow">CODECS</p>
          <h2>编解码配置</h2>
        </div>
        <span class="summary">${report.codecs.filter(codec => codec.supported).length}/${report.codecs.length} 可用</span>
      </div>
      <div class="table-shell">
        <table>
          <thead><tr><th>探测项</th><th>Codec</th><th>结果</th></tr></thead>
          <tbody>${codecSummary(report)}</tbody>
        </table>
      </div>
    </section>

    <section>
      <div class="section-heading">
        <div>
          <p class="eyebrow">DIAGNOSTICS</p>
          <h2>可解释差异</h2>
        </div>
        <span class="summary">${report.diagnostics.length} 条</span>
      </div>
      <div class="diagnostics">
        ${
          report.diagnostics.length === 0
            ? '<p class="empty">当前探测项均可用。</p>'
            : report.diagnostics
                .map(
                  entry => `<article><code>${entry.code}</code><p>${entry.message}</p></article>`,
                )
                .join('')
        }
      </div>
    </section>

    <footer>Report Schema ${report.schemaVersion} · 所有结论绑定当前配置，不根据版本字符串推断。</footer>
  `;

  document.querySelector('#download-report')?.addEventListener('click', () => {
    downloadReport(report);
  });
}

async function run(): Promise<void> {
  app.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <h1>正在探测浏览器能力</h1>
      <p>验证 GPU、编解码、音频与文件输出配置…</p>
    </div>
  `;
  try {
    const report = await probeCapabilities({ includeAdapterDetails: true });
    Reflect.set(globalThis, '__AELION_CAPABILITY_REPORT__', report);
    render(report);
  } catch (error) {
    app.innerHTML = `
      <div class="failure">
        <p class="eyebrow">PROBE FAILED</p>
        <h1>能力探测未完成</h1>
        <p>${error instanceof Error ? error.message : '未知错误'}</p>
      </div>
    `;
  }
}

await run();
