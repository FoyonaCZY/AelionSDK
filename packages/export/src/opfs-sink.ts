import type { StreamTargetChunk } from 'mediabunny';

export interface OpfsSinkSnapshot {
  readonly fileName: string;
  readonly writes: number;
  readonly bytesWritten: number;
  readonly maxInFlightWrites: number;
  readonly closed: boolean;
  readonly aborted: boolean;
}

export class OpfsSeekableSink {
  readonly #fileName: string;
  readonly #handlePromise: Promise<FileSystemFileHandle>;
  #streamPromise?: Promise<FileSystemWritableFileStream>;
  #writes = 0;
  #bytesWritten = 0;
  #inFlightWrites = 0;
  #maxInFlightWrites = 0;
  #closed = false;
  #aborted = false;

  public constructor(fileName: string) {
    if (fileName.length === 0 || fileName.includes('/')) {
      throw new TypeError('OPFS fileName must be a non-empty leaf name');
    }
    this.#fileName = fileName;
    this.#handlePromise = navigator.storage
      .getDirectory()
      .then(directory => directory.getFileHandle(fileName, { create: true }));
  }

  public readonly writable = new WritableStream<StreamTargetChunk>({
    write: async chunk => {
      if (this.#closed || this.#aborted) throw new Error('OPFS sink is not writable');
      this.#inFlightWrites += 1;
      this.#maxInFlightWrites = Math.max(this.#maxInFlightWrites, this.#inFlightWrites);
      try {
        const stream = await this.#stream();
        await stream.write({
          type: 'write',
          position: chunk.position,
          data: chunk.data,
        });
        this.#writes += 1;
        this.#bytesWritten += chunk.data.byteLength;
      } finally {
        this.#inFlightWrites -= 1;
      }
    },
    close: async () => {
      if (this.#closed || this.#aborted) return;
      this.#closed = true;
      await (await this.#stream()).close();
    },
    abort: async () => {
      await this.cleanup();
    },
  });

  public async getFile(): Promise<File> {
    if (!this.#closed) throw new Error('OPFS sink is not finalized');
    return (await this.#handlePromise).getFile();
  }

  public async cleanup(): Promise<void> {
    if (this.#aborted) return;
    this.#aborted = true;
    const stream = await this.#streamPromise;
    if (stream !== undefined) await stream.abort().catch(() => undefined);
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(this.#fileName).catch(() => undefined);
  }

  public snapshot(): OpfsSinkSnapshot {
    return {
      fileName: this.#fileName,
      writes: this.#writes,
      bytesWritten: this.#bytesWritten,
      maxInFlightWrites: this.#maxInFlightWrites,
      closed: this.#closed,
      aborted: this.#aborted,
    };
  }

  #stream(): Promise<FileSystemWritableFileStream> {
    this.#streamPromise ??= this.#handlePromise.then(handle => handle.createWritable());
    return this.#streamPromise;
  }
}
