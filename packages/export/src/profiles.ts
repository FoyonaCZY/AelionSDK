export type ExportProfileId =
  | 'webm-vp9-opus'
  | 'mp4-h264-aac'
  | 'still-png'
  | 'still-jpeg'
  | 'still-webp'
  | 'animated-gif'
  | 'audio-wav';

export interface ExportProfile {
  readonly id: ExportProfileId;
  readonly kind: 'muxed-av' | 'still' | 'animated-image' | 'audio-only';
  readonly mimeType: string;
  readonly extension: string;
  readonly videoCodec?: string;
  readonly audioCodec?: string;
  readonly resumability: 'restart-local' | 'checkpointed-units' | 'provider';
}

export const EXPORT_PROFILES: Readonly<Record<ExportProfileId, ExportProfile>> = Object.freeze({
  'webm-vp9-opus': {
    id: 'webm-vp9-opus',
    kind: 'muxed-av',
    mimeType: 'video/webm',
    extension: '.webm',
    videoCodec: 'vp09.00.10.08',
    audioCodec: 'opus',
    resumability: 'restart-local',
  },
  'mp4-h264-aac': {
    id: 'mp4-h264-aac',
    kind: 'muxed-av',
    mimeType: 'video/mp4',
    extension: '.mp4',
    videoCodec: 'avc1.640028',
    audioCodec: 'mp4a.40.2',
    resumability: 'restart-local',
  },
  'still-png': {
    id: 'still-png',
    kind: 'still',
    mimeType: 'image/png',
    extension: '.png',
    resumability: 'checkpointed-units',
  },
  'still-jpeg': {
    id: 'still-jpeg',
    kind: 'still',
    mimeType: 'image/jpeg',
    extension: '.jpg',
    resumability: 'checkpointed-units',
  },
  'still-webp': {
    id: 'still-webp',
    kind: 'still',
    mimeType: 'image/webp',
    extension: '.webp',
    resumability: 'checkpointed-units',
  },
  'animated-gif': {
    id: 'animated-gif',
    kind: 'animated-image',
    mimeType: 'image/gif',
    extension: '.gif',
    resumability: 'checkpointed-units',
  },
  'audio-wav': {
    id: 'audio-wav',
    kind: 'audio-only',
    mimeType: 'audio/wav',
    extension: '.wav',
    resumability: 'checkpointed-units',
  },
});

export interface ExportProfileSupport {
  readonly profile: ExportProfile;
  readonly supported: boolean;
  readonly reasons: readonly string[];
}

export interface ExportCapabilityProbeOptions {
  readonly width?: number;
  readonly height?: number;
  readonly framerate?: number;
  readonly sampleRate?: number;
  readonly numberOfChannels?: number;
  readonly videoBitrate?: number;
  readonly audioBitrate?: number;
}

async function encoderSupport(
  profile: ExportProfile,
  options: ExportCapabilityProbeOptions = {},
): Promise<ExportProfileSupport> {
  const reasons: string[] = [];
  if (profile.videoCodec !== undefined) {
    if (typeof VideoEncoder !== 'function') reasons.push('EXPORT_VIDEO_ENCODER_UNAVAILABLE');
    else {
      try {
        const supported = await VideoEncoder.isConfigSupported({
          codec: profile.videoCodec,
          width: options.width ?? 1_280,
          height: options.height ?? 720,
          bitrate: options.videoBitrate ?? 4_000_000,
          framerate: options.framerate ?? 30,
        });
        if (!supported.supported) reasons.push('EXPORT_VIDEO_CONFIG_UNSUPPORTED');
      } catch {
        reasons.push('EXPORT_VIDEO_CONFIG_PROBE_FAILED');
      }
    }
  }
  if (profile.audioCodec !== undefined) {
    if (typeof AudioEncoder !== 'function') reasons.push('EXPORT_AUDIO_ENCODER_UNAVAILABLE');
    else {
      try {
        const supported = await AudioEncoder.isConfigSupported({
          codec: profile.audioCodec,
          sampleRate: options.sampleRate ?? 48_000,
          numberOfChannels: options.numberOfChannels ?? 2,
          bitrate: options.audioBitrate ?? 128_000,
        });
        if (!supported.supported) reasons.push('EXPORT_AUDIO_CONFIG_UNSUPPORTED');
      } catch {
        reasons.push('EXPORT_AUDIO_CONFIG_PROBE_FAILED');
      }
    }
  }
  if (profile.kind === 'still' && typeof OffscreenCanvas !== 'function') {
    reasons.push('EXPORT_IMAGE_CANVAS_UNAVAILABLE');
  }
  if (profile.kind === 'animated-image' && typeof OffscreenCanvas !== 'function') {
    reasons.push('EXPORT_IMAGE_CANVAS_UNAVAILABLE');
  }
  return { profile, supported: reasons.length === 0, reasons };
}

export async function probeExportProfiles(
  options: ExportCapabilityProbeOptions = {},
): Promise<readonly ExportProfileSupport[]> {
  return Promise.all(
    Object.values(EXPORT_PROFILES).map(profile => encoderSupport(profile, options)),
  );
}

export interface SelectExportProfileOptions extends ExportCapabilityProbeOptions {
  readonly preferred: ExportProfileId;
  readonly fallbacks?: readonly ExportProfileId[];
  readonly remoteAvailable?: boolean;
}

export interface ExportProfileSelection {
  readonly selected?: ExportProfile;
  readonly execution: 'local' | 'remote' | 'unsupported';
  readonly attempts: readonly ExportProfileSupport[];
}

export async function selectExportProfile(
  options: SelectExportProfileOptions,
): Promise<ExportProfileSelection> {
  const ids = [options.preferred, ...(options.fallbacks ?? [])].filter(
    (id, index, values) => values.indexOf(id) === index,
  );
  const attempts: ExportProfileSupport[] = [];
  for (const id of ids) {
    const profile = (EXPORT_PROFILES as Partial<Record<string, ExportProfile>>)[id];
    if (profile === undefined) {
      throw new RangeError(`Unknown export profile ${String(id)}`);
    }
    const support = await encoderSupport(profile, options);
    attempts.push(support);
    if (support.supported) return { selected: support.profile, execution: 'local', attempts };
  }
  return options.remoteAvailable === true
    ? { selected: EXPORT_PROFILES[options.preferred], execution: 'remote', attempts }
    : { execution: 'unsupported', attempts };
}
