import { SeekableMemorySink } from '@aelion/export';
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  createProject,
  seconds,
  type AelionSessionApi,
  type ImportedMedia,
  type PreviewCanvasController,
} from '@aelion/sdk';

import './style.css';

function get(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`找不到页面元素：${selector}`);
  return element;
}

const fileInput = get('#media-file') as HTMLInputElement;
const canvas = get('#preview') as HTMLCanvasElement;
const empty = get('#empty') as HTMLElement;
const playButton = get('#play') as HTMLButtonElement;
const scrubber = get('#scrubber') as HTMLInputElement;
const timecode = get('#timecode') as HTMLOutputElement;
const moveButton = get('#move') as HTMLButtonElement;
const undoButton = get('#undo') as HTMLButtonElement;
const redoButton = get('#redo') as HTMLButtonElement;
const exportButton = get('#export') as HTMLButtonElement;
const status = get('#status') as HTMLElement;
const progress = get('#progress') as HTMLProgressElement;

let media: ProductionMediaProvider | undefined;
let session: AelionSessionApi | undefined;
let preview: PreviewCanvasController | undefined;
let imported: ImportedMedia | undefined;
let durationUs = 1;
let currentTimeUs = 0;

function setStatus(message: string): void {
  status.textContent = message;
}

function formatTime(timeUs: number): string {
  const totalMs = Math.floor(timeUs / 1_000);
  const minutes = Math.floor(totalMs / 60_000);
  const secondsPart = Math.floor((totalMs % 60_000) / 1_000);
  const milliseconds = totalMs % 1_000;
  return `${minutes.toString().padStart(2, '0')}:${secondsPart
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function setCurrentTime(timeUs: number): void {
  currentTimeUs = Math.min(Math.max(0, timeUs), Math.max(0, durationUs - 1));
  scrubber.value = currentTimeUs.toString();
  timecode.value = formatTime(currentTimeUs);
}

function updateButtons(): void {
  const ready = session?.state === 'ready';
  playButton.disabled = !ready;
  scrubber.disabled = !ready;
  moveButton.disabled = !ready || imported === undefined;
  exportButton.disabled = !ready;
  undoButton.disabled = !ready || session?.transaction.canUndo !== true;
  redoButton.disabled = !ready || session?.transaction.canRedo !== true;
}

async function disposeRuntime(): Promise<void> {
  preview?.dispose();
  preview = undefined;
  if (session !== undefined) await session.dispose();
  session = undefined;
  media?.dispose();
  media = undefined;
  imported = undefined;
}

async function openFile(file: File): Promise<void> {
  setStatus(`正在分析 ${file.name}…`);
  updateButtons();
  await disposeRuntime();

  const nextMedia = new ProductionMediaProvider();
  nextMedia.registerFile('asset_main', file);
  media = nextMedia;

  try {
    const probe = await nextMedia.probe('asset_main');
    const videoTrack = probe.index.tracks.find(track => track.kind === 'video');
    const builder = createProject({
      projectId: 'quickstart_project',
      sequenceId: 'main_sequence',
      title: file.name,
      width: videoTrack?.codedWidth ?? 1920,
      height: videoTrack?.codedHeight ?? 1080,
      frameRate: { numerator: 30, denominator: 1 },
    });

    imported = await builder.importMedia({
      provider: nextMedia,
      assetId: 'asset_main',
      name: file.name,
      ...(file.type.length === 0 ? {} : { mimeType: file.type }),
    });

    const nextSession = await Aelion.createSession({ media: nextMedia });
    await nextSession.loadProject(builder.build());
    session = nextSession;
    durationUs = nextSession.getSnapshot().renderIr?.durationUs ?? imported.durationUs;
    scrubber.max = Math.max(0, durationUs - 1).toString();

    preview = attachPreviewCanvas(nextSession, canvas, {
      quality: 'adaptive',
      fit: 'contain',
      pauseWhenHidden: true,
      onFrame: frame => setCurrentTime(frame.timeUs),
      onError: error => setStatus(error instanceof Error ? error.message : '预览失败'),
    });

    nextSession.subscribe('project-changed', () => updateButtons());
    empty.hidden = true;
    setCurrentTime(0);
    await preview.render(0);
    setStatus(
      `已载入 ${probe.index.container.toUpperCase()}，共 ${probe.index.tracks.length.toString()} 条媒体流`,
    );
  } catch (error) {
    await disposeRuntime();
    empty.hidden = false;
    setStatus(error instanceof Error ? error.message : '素材导入失败');
  } finally {
    updateButtons();
  }
}

async function moveClipOneSecond(): Promise<void> {
  if (session === undefined || imported === undefined) return;
  if (imported.linkGroupId !== undefined) {
    session.transaction.commands.moveLinkedGroup({
      groupId: imported.linkGroupId,
      deltaUs: seconds(1),
    });
  } else {
    const itemId = imported.videoItemId ?? imported.audioItemId;
    if (itemId === undefined) return;
    const item = session.getSnapshot().project?.items[itemId];
    if (item === undefined) return;
    session.transaction.commands.moveItem({
      itemId,
      startUs: item.range.startUs + seconds(1),
    });
  }
  await preview?.render(currentTimeUs);
  setStatus('片段已右移 1 秒，可以点击“撤销”恢复');
}

function download(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: 'aelion-quickstart.mp4',
  });
  link.click();
  URL.revokeObjectURL(url);
}

async function exportMp4(): Promise<void> {
  if (session === undefined) return;
  exportButton.disabled = true;
  progress.value = 0;
  const sink = new SeekableMemorySink();
  const options = {
    profile: 'mp4-h264-aac' as const,
    sink: sink.writable,
    videoBitrate: 8_000_000,
    audioBitrate: 192_000,
    onProgress: (value: number) => {
      progress.value = value;
    },
    cleanupSink: () => sink.cleanup(),
  };

  try {
    setStatus('正在检查当前浏览器能否导出 H.264/AAC…');
    const report = await session.export.preflightProfile(options);
    if (!report.ok) {
      setStatus(`当前环境不能导出 MP4：${report.issues.map(issue => issue.code).join(', ')}`);
      sink.cleanup();
      return;
    }

    setStatus('正在导出…');
    await session.export.startProfile(options);
    download(sink.finalize());
    setStatus('导出完成');
  } catch (error) {
    sink.cleanup();
    setStatus(error instanceof Error ? error.message : '导出失败');
  } finally {
    updateButtons();
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file !== undefined) void openFile(file);
});

playButton.addEventListener('click', () => {
  void (async () => {
    if (session === undefined) return;
    if (session.player.state === 'playing') {
      await session.player.pause();
      playButton.textContent = '播放';
    } else {
      await session.player.seek(currentTimeUs);
      await session.player.play();
      playButton.textContent = '暂停';
    }
  })();
});

scrubber.addEventListener('input', () => {
  setCurrentTime(Number(scrubber.value));
  void preview?.render(currentTimeUs);
});

moveButton.addEventListener('click', () => void moveClipOneSecond());
undoButton.addEventListener('click', () => {
  session?.transaction.undo();
  updateButtons();
  void preview?.render(currentTimeUs);
});
redoButton.addEventListener('click', () => {
  session?.transaction.redo();
  updateButtons();
  void preview?.render(currentTimeUs);
});
exportButton.addEventListener('click', () => void exportMp4());

window.addEventListener('beforeunload', () => {
  preview?.dispose();
  void session?.dispose();
  media?.dispose();
});

updateButtons();
