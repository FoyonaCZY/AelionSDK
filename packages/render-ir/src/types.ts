import type { JsonObject, JsonValue, Rational } from '@aelion/core';
import type { WebGl2MaterialProgram } from '@aelion/material-compiler';
import type { TimeRange } from '@aelion/project-schema';

export interface IrMaterialDefinition {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly packageIntegrity: string;
  readonly materialId: string;
}

export interface IrMaterialInstance {
  readonly id: string;
  readonly definition: IrMaterialDefinition;
  readonly enabled: boolean;
  readonly previewPolicy: 'required' | 'skippable-when-degraded';
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly resourceBindings: Readonly<Record<string, JsonValue>>;
  readonly inputBindings: Readonly<Record<string, JsonValue>>;
  readonly program?: WebGl2MaterialProgram;
}

export type MaterialProgramResolver = (
  definition: IrMaterialDefinition,
  parameters: Readonly<Record<string, JsonValue>>,
) => WebGl2MaterialProgram | undefined;

export interface RenderCompileOptions {
  readonly affectedRanges?: RenderIrCompilation['stats']['affectedRanges'];
  readonly affectedEntityIds?: readonly string[];
  readonly resolveMaterialProgram?: MaterialProgramResolver;
}

export interface IrMediaSource {
  readonly assetId: string;
  readonly streamType: 'video' | 'audio';
  readonly streamIndex: number;
  readonly sourceRange: TimeRange;
  readonly rate: Rational;
  readonly reverse: boolean;
  readonly boundary: 'error' | 'hold' | 'loop' | 'transparent';
}

export interface IrBaseClip {
  readonly id: string;
  readonly trackId: string;
  readonly range: TimeRange;
  readonly enabled: boolean;
  readonly materialInstanceIds: readonly string[];
  readonly dependencyEntityIds: readonly string[];
  readonly fingerprint: string;
}

export interface IrVisualClip extends IrBaseClip {
  readonly kind: 'visual-clip';
  readonly source: IrMediaSource;
  readonly visual: IrVisualProperties;
}

export interface IrVec2 {
  readonly x: number;
  readonly y: number;
}

export interface IrVisualProperties {
  readonly fit: 'contain' | 'cover' | 'fill' | 'none';
  readonly transform: {
    readonly positionPx: IrVec2 | JsonObject;
    readonly anchor: IrVec2 | JsonObject;
    readonly scale: IrVec2 | JsonObject;
    readonly rotationDeg: number | JsonObject;
    readonly skewDeg: IrVec2 | JsonObject;
  };
  readonly crop: JsonObject;
  readonly opacity: number | JsonObject;
  readonly blendMode: string;
}

export interface IrAudioClip extends IrBaseClip {
  readonly kind: 'audio-clip';
  readonly source: IrMediaSource;
  readonly audio: JsonObject;
}

export type IrClip = IrVisualClip | IrAudioClip;

export interface IrTrack {
  readonly id: string;
  readonly kind: 'visual' | 'audio' | 'caption';
  readonly enabled: boolean;
  /** Track-level mixer state. Present for audio tracks compiled from Project v1. */
  readonly audio?: JsonObject;
  readonly clips: readonly IrClip[];
  readonly materialInstanceIds: readonly string[];
  readonly fingerprint: string;
}

export interface IrTransition {
  readonly id: string;
  readonly trackId: string;
  readonly fromItemId: string;
  readonly toItemId: string;
  readonly range: TimeRange;
  readonly materialInstanceId: string;
  readonly dependencyEntityIds: readonly string[];
  readonly fingerprint: string;
}

export interface RenderIr {
  readonly irVersion: '1.0.0';
  readonly projectId: string;
  readonly sequenceId: string;
  readonly revision: bigint;
  readonly width: number;
  readonly height: number;
  readonly frameRate: Rational;
  readonly sampleRate: number;
  readonly channelLayout: string;
  readonly workingColorSpace: string;
  readonly durationUs: number;
  readonly tracks: readonly IrTrack[];
  readonly transitions: readonly IrTransition[];
  readonly materials: Readonly<Record<string, IrMaterialInstance>>;
}

export interface CompileStats {
  readonly compiledClips: number;
  readonly reusedClips: number;
  readonly compiledTransitions: number;
  readonly reusedTransitions: number;
  readonly affectedRanges: readonly {
    readonly sequenceId: string;
    readonly startUs: number;
    readonly durationUs: number;
  }[];
}

export interface RenderIrCompilation {
  readonly ir: RenderIr;
  readonly stats: CompileStats;
}

export interface ActiveVisualState {
  readonly timeUs: number;
  readonly clips: readonly {
    readonly clip: IrVisualClip;
    readonly sourceTimeUs: number | null;
    readonly materials: readonly IrMaterialInstance[];
  }[];
  readonly transition?: {
    readonly transition: IrTransition;
    readonly progress: number;
    readonly material: IrMaterialInstance;
  };
}

export interface EvaluatedMaterialInstance {
  readonly id: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly resourceBindings: Readonly<Record<string, JsonValue>>;
  readonly inputBindings: Readonly<Record<string, JsonValue>>;
}

export interface ActiveAudioState {
  readonly startUs: number;
  readonly durationUs: number;
  readonly clips: readonly {
    readonly clip: IrAudioClip;
    readonly sourceStartUs: number;
    readonly sequenceStartUs: number;
    readonly durationUs: number;
    readonly gain: number;
    readonly pan: number;
  }[];
}
