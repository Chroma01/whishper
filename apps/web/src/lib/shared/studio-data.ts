import type { MediaDerivativeKind } from "@anysub/contracts";

import type { AudioTrack } from "./audio-tracks";
import type { TranscriptionDefaults } from "./instance-settings";

import type {
  SubtitleCueSnapshot,
  SubtitleTrack,
  SubtitleTrackSummary,
} from "./subtitles";
import type {
  AvailableTranscriptionModel,
  DetectedWorkerHardware,
} from "./transcription-models";
import type { ProbeState } from "./project-status";

export type StudioProject = {
  id: string;
  name: string;
  createdAt: Date;
  workspaceName: string;
  mediaFilename: string | null;
  hasSourceMedia: boolean;
  mediaType: string | null;
  uploadStatus: string | null;
  sizeBytes: number | null;
  mediaDurationUs: number | null;
  mediaPreparationStatus: ProbeState;
  mediaProbe: Record<string, unknown> | null;
  audioTracks: AudioTrack[];
  mediaFrameRateNum: number | null;
  mediaFrameRateDen: number | null;
  mediaSeekable: boolean | null;
  mediaProxyRecommended: boolean | null;
};

type JobProgress = {
  progress: number | null;
  progressMessage: string | null;
  error: Record<string, unknown> | null;
};

export type StudioRun = JobProgress & {
  id: string;
  status: string;
  adapterId: string;
  modelId: string;
  audioTrack: number;
  // Null while the run detects the language.
  language: string | null;
  jobState: string | null;
};

export type StudioPreparation = JobProgress & {
  state: string;
  audioTrack: number;
};

export type StudioStatus = {
  run: StudioRun | null;
  // The newest preparation of each audio track, newest first.
  preparations: StudioPreparation[];
};

export type StudioDerivative = {
  kind: MediaDerivativeKind;
  audioTrack: number;
  mediaType: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
};

export type StudioData = {
  project: StudioProject & { canManage: boolean };
  run: StudioRun | null;
  preparations: StudioPreparation[];
  derivatives: (StudioDerivative & { url: string })[];
  track: SubtitleTrack | null;
  // Oldest first.
  tracks: SubtitleTrackSummary[];
  cues: SubtitleCueSnapshot[];
  transcriptionModels: AvailableTranscriptionModel[];
  transcriptionDefaults: TranscriptionDefaults;
  detectedHardware: DetectedWorkerHardware[];
};
