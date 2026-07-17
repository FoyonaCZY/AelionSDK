import { SeekableMemorySink } from '@aelion/export';
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  createProject,
  seconds,
  type AelionSessionApi,
  type PreviewCanvasController,
  type PreviewCanvasQuality,
} from '@aelion/sdk';

import './style.css';

function element(selector: string): Element {
  const value = document.querySelector(selector);
  if (value === null) throw new Error(`Missing editor element: ${selector}`);
  return value;
}

const canvas = element('#preview') as HTMLCanvasElement;
const status = element('#status') as HTMLElement;
const assetList = element('#asset-list') as HTMLElement;
const emptyState = element('#empty-state') as HTMLLabelElement;
const primaryFile = element('#media-file') as HTMLInputElement;
const emptyFile = element('#empty-state input') as HTMLInputElement;
const playButton = element('#play') as HTMLButtonElement;
const timecode = element('#timecode') as HTMLElement;
const scrubber = element('#scrubber') as HTMLInputElement;
const quality = element('#quality') as HTMLSelectElement;
const tracks = element('#tracks') as HTMLElement;
const durationLabel = element('#duration') as HTMLElement;
const playhead = element('#playhead') as HTMLElement;
const inspector = element('#inspector') as HTMLElement;
const undo = element('#undo') as HTMLButtonElement;
const redo = element('#redo') as HTMLButtonElement;
const split = element('#split') as HTMLButtonElement;
const moveLeft = element('#move-left') as HTMLButtonElement;
const moveRight = element('#move-right') as HTMLButtonElement;
const profile = element('#profile') as HTMLSelectElement;
const exportButton = element('#export') as HTMLButtonElement;
const progress = element('#progress') as HTMLElement;

let media: ProductionMediaProvider | undefined;
let session: AelionSessionApi | undefined;
let preview: PreviewCanvasController | undefined;
let durationUs = 1;
let currentTimeUs = 0;
let selectedItemId: string | undefined;
let idCounter = 0;

function safeText(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(value: number, precise = true): string {
  const clamped = Math.max(0, Math.round(value));
  const totalMilliseconds = Math.floor(clamped / 1_000);
  const milliseconds = totalMilliseconds % 1_000;
  const totalSeconds = Math.floor(totalMilliseconds / 1_000);
  const secondsPart = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const base = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secondsPart.toString().padStart(2, '0')}`;
  return precise ? `${base}.${milliseconds.toString().padStart(3, '0')}` : base.slice(3);
}

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.closest('.project-state')?.classList.toggle('error', error);
}

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString()}`;
}

function setEditorEnabled(enabled: boolean): void {
  for (const control of [playButton, scrubber, quality, profile, exportButton]) {
    control.disabled = !enabled;
  }
  syncCommandState();
}

function syncCommandState(): void {
  const active = session !== undefined;
  undo.disabled = !active || session?.transaction.canUndo !== true;
  redo.disabled = !active || session?.transaction.canRedo !== true;
  split.disabled = !active || selectedItemId === undefined;
  moveLeft.disabled = !active || selectedItemId === undefined;
  moveRight.disabled = !active || selectedItemId === undefined;
}

function syncPlayhead(timeUs: number): void {
  currentTimeUs = Math.min(Math.max(0, timeUs), Math.max(0, durationUs - 1));
  scrubber.value = currentTimeUs.toString();
  timecode.textContent = formatTime(currentTimeUs);
  playhead.style.left = `${((currentTimeUs / durationUs) * 100).toFixed(4)}%`;
}

function renderProject(): void {
  const project = session?.getSnapshot().project;
  if (project === null || project === undefined) return;
  const sequence = project.sequences[project.settings.defaultSequenceId];
  if (sequence === undefined) return;
  const rows: string[] = [];
  for (const trackId of sequence.trackIds) {
    const track = project.tracks[trackId];
    if (track === undefined) continue;
    const clips = track.itemIds.flatMap(itemId => {
      const item = project.items[itemId];
      if (item === undefined) return [];
      const left = (item.range.startUs / durationUs) * 100;
      const width = (item.range.durationUs / durationUs) * 100;
      const name = typeof item.name === 'string' ? item.name : item.type;
      return [
        `<button class="clip clip-${track.kind}${item.id === selectedItemId ? ' selected' : ''}" data-item="${safeText(item.id)}" style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%" type="button"><span>${safeText(name)}</span><small>${formatTime(item.range.durationUs, false)}</small></button>`,
      ];
    });
    rows.push(`
      <div class="track-row">
        <div class="track-label"><span>${track.kind === 'visual' ? 'V' : track.kind === 'audio' ? 'A' : 'C'}</span><strong>${safeText(typeof track.name === 'string' ? track.name : track.kind)}</strong></div>
        <div class="track-lane">${clips.join('')}</div>
      </div>
    `);
  }
  tracks.innerHTML = rows.join('');
  for (const clip of tracks.querySelectorAll<HTMLButtonElement>('[data-item]')) {
    clip.addEventListener('click', () => {
      selectedItemId = clip.dataset.item;
      renderProject();
      renderInspector();
      syncCommandState();
    });
  }
  syncCommandState();
}

function renderInspector(): void {
  const project = session?.getSnapshot().project;
  const item = selectedItemId === undefined ? undefined : project?.items[selectedItemId];
  if (item === undefined) {
    inspector.innerHTML = '<p class="empty-copy">在时间线上选择一个片段。</p>';
    return;
  }
  inspector.innerHTML = `
    <dl class="properties">
      <div><dt>片段</dt><dd>${safeText(item.id)}</dd></div>
      <div><dt>类型</dt><dd>${safeText(item.type)}</dd></div>
      <div><dt>开始</dt><dd>${formatTime(item.range.startUs)}</dd></div>
      <div><dt>时长</dt><dd>${formatTime(item.range.durationUs)}</dd></div>
      <div><dt>联动</dt><dd>${safeText(item.linkGroupId ?? '—')}</dd></div>
    </dl>
  `;
}

async function refreshPreview(): Promise<void> {
  renderProject();
  renderInspector();
  await preview?.render(currentTimeUs);
}

async function releaseProject(): Promise<void> {
  preview?.dispose();
  preview = undefined;
  if (session !== undefined) await session.dispose();
  session = undefined;
  media?.dispose();
  media = undefined;
}

async function importFile(file: File): Promise<void> {
  setStatus(`正在分析 ${file.name}…`);
  setEditorEnabled(false);
  await releaseProject();
  selectedItemId = undefined;
  currentTimeUs = 0;
  const provider = new ProductionMediaProvider();
  provider.registerFile('asset_media', file);
  media = provider;
  try {
    const probe = await provider.probe('asset_media');
    const video = probe.index.tracks.find(track => track.kind === 'video');
    const builder = createProject({
      projectId: 'editor_project',
      sequenceId: 'main_sequence',
      title: file.name,
      sequenceName: 'Main Timeline',
      width: video?.codedWidth ?? 1920,
      height: video?.codedHeight ?? 1080,
      frameRate: { numerator: 30, denominator: 1 },
    });
    const imported = await builder.importMedia({
      provider,
      assetId: 'asset_media',
      name: file.name,
      ...(file.type.length === 0 ? {} : { mimeType: file.type }),
    });
    const nextSession = await Aelion.createSession({
      media: provider,
      preferredBackend: 'webgl2',
      allowBackendFallback: true,
    });
    await nextSession.loadProject(builder.build());
    session = nextSession;
    durationUs = nextSession.getSnapshot().renderIr?.durationUs ?? imported.durationUs;
    scrubber.max = Math.max(0, durationUs - 1).toString();
    durationLabel.textContent = formatTime(durationUs, false);
    selectedItemId = imported.videoItemId ?? imported.audioItemId;
    preview = attachPreviewCanvas(nextSession, canvas, {
      quality: 'adaptive',
      fit: 'contain',
      onFrame: frame => syncPlayhead(frame.timeUs),
      onError: error => setStatus(error instanceof Error ? error.message : '预览失败', true),
    });
    assetList.innerHTML = `
      <article class="asset-card"><div class="asset-thumb">${video === undefined ? '♪' : '▶'}</div><div><strong>${safeText(file.name)}</strong><span>${formatTime(probe.index.durationUs, false)} · ${safeText(probe.index.container.toUpperCase())}</span></div></article>
    `;
    emptyState.hidden = true;
    setEditorEnabled(true);
    renderProject();
    renderInspector();
    syncPlayhead(0);
    await preview.render(0);
    setStatus(
      `${probe.index.container.toUpperCase()} · Range Provider · ${probe.index.tracks.length.toString()} 条媒体流`,
    );
  } catch (error) {
    await releaseProject();
    emptyState.hidden = false;
    setStatus(error instanceof Error ? error.message : '媒体导入失败', true);
    throw error;
  }
}

async function moveSelection(deltaUs: number): Promise<void> {
  if (session === undefined || selectedItemId === undefined) return;
  const project = session.getSnapshot().project;
  if (project === null) return;
  const item = project.items[selectedItemId];
  if (item === undefined) return;
  if (item.linkGroupId !== undefined) {
    const group = project.linkGroups[item.linkGroupId];
    const starts = group?.itemIds.map(id => project.items[id]?.range.startUs ?? 0) ?? [0];
    const allowed = Math.max(deltaUs, -Math.min(...starts));
    session.transaction.commands.moveLinkedGroup({ groupId: item.linkGroupId, deltaUs: allowed });
  } else {
    session.transaction.commands.moveItem({
      itemId: item.id,
      startUs: Math.max(0, item.range.startUs + deltaUs),
    });
  }
  await refreshPreview();
}

async function splitSelection(): Promise<void> {
  if (session === undefined || selectedItemId === undefined) return;
  const project = session.getSnapshot().project;
  if (project === null) return;
  const item = project.items[selectedItemId];
  if (item === undefined) return;
  if (
    currentTimeUs <= item.range.startUs ||
    currentTimeUs >= item.range.startUs + item.range.durationUs
  ) {
    setStatus('把播放头放到片段内部再分割', true);
    return;
  }
  if (item.linkGroupId !== undefined) {
    const group = project.linkGroups[item.linkGroupId];
    if (group === undefined) return;
    const rightItemIds = Object.fromEntries(group.itemIds.map(id => [id, nextId('item_split')]));
    const result = session.transaction.commands.splitLinkedGroup({
      groupId: group.id,
      rightGroupId: nextId('link_split'),
      atUs: currentTimeUs,
      rightItemIds,
    });
    selectedItemId = result.rightItemIds[item.id];
  } else {
    const result = session.transaction.commands.splitItem({
      itemId: item.id,
      rightItemId: nextId('item_split'),
      atUs: currentTimeUs,
    });
    selectedItemId = result.rightItemId;
  }
  await refreshPreview();
  setStatus('已分割片段');
}

function download(bytes: Uint8Array, name: string, mimeType: string): void {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportProject(): Promise<void> {
  if (session === undefined) return;
  exportButton.disabled = true;
  progress.style.width = '0%';
  const sink = new SeekableMemorySink();
  const selectedProfile = profile.value;
  try {
    setStatus(`正在导出 ${selectedProfile}…`);
    const onProgress = (value: number): void => {
      progress.style.width = `${(value * 100).toFixed(1)}%`;
    };
    if (selectedProfile === 'mp4-h264-aac') {
      await session.export.startProfile({
        profile: 'mp4-h264-aac',
        sink: sink.writable,
        videoBitrate: 8_000_000,
        audioBitrate: 192_000,
        onProgress,
      });
      download(sink.finalize(), 'aelion-export.mp4', 'video/mp4');
    } else {
      await session.export.start({
        sink: sink.writable,
        videoBitrate: 4_000_000,
        audioBitrate: 128_000,
        onProgress,
      });
      download(sink.finalize(), 'aelion-export.webm', 'video/webm');
    }
    setStatus('导出完成');
  } catch (error) {
    sink.cleanup();
    setStatus(error instanceof Error ? error.message : '导出失败', true);
  } finally {
    exportButton.disabled = false;
  }
}

async function onFileInput(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined) return;
  try {
    await importFile(file);
  } catch {
    // Status and cleanup are handled by importFile.
  }
}

primaryFile.addEventListener('change', () => void onFileInput(primaryFile));
emptyFile.addEventListener('change', () => void onFileInput(emptyFile));
playButton.addEventListener('click', () => {
  void (async () => {
    if (session === undefined) return;
    if (session.player.state === 'playing') {
      await session.player.pause();
      playButton.textContent = '▶';
      return;
    }
    await session.player.seek(currentTimeUs);
    await session.player.play();
    playButton.textContent = '❚❚';
  })().catch((error: unknown) =>
    setStatus(error instanceof Error ? error.message : '播放失败', true),
  );
});
scrubber.addEventListener('input', () => {
  const value = Number(scrubber.value);
  syncPlayhead(value);
  void preview?.render(value);
});
quality.addEventListener('change', () => {
  preview?.setQuality(quality.value as PreviewCanvasQuality);
  void preview?.render(currentTimeUs);
});
undo.addEventListener('click', () => {
  if (session?.transaction.canUndo !== true) return;
  session.transaction.undo();
  void refreshPreview();
});
redo.addEventListener('click', () => {
  if (session?.transaction.canRedo !== true) return;
  session.transaction.redo();
  void refreshPreview();
});
split.addEventListener('click', () => void splitSelection());
moveLeft.addEventListener('click', () => void moveSelection(-seconds(1)));
moveRight.addEventListener('click', () => void moveSelection(seconds(1)));
exportButton.addEventListener('click', () => void exportProject());

setEditorEnabled(false);
syncPlayhead(0);
window.addEventListener('beforeunload', () => {
  preview?.dispose();
  media?.dispose();
});
