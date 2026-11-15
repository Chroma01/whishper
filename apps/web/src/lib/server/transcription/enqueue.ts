import type { TranscriptionJobPayload } from "@anysub/contracts";

import { jobs, transcriptionRuns } from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import { badRequest, conflict, notFound } from "#lib/server/http/errors.ts";
import { prepareTranscriptAudio } from "#lib/server/media/audio-track.ts";
import { projectForUser } from "#lib/server/projects/access.ts";
import { readInstanceSettings } from "#lib/server/settings/instance.ts";
import { resolveDataPath } from "#lib/server/storage/paths.ts";
import { hasActiveTranscriptionRun } from "#lib/server/transcription/active-run.ts";
import { transcriptionModelChoices } from "#lib/server/transcription/models.ts";
import { activeWorkerManifests } from "#lib/server/workers/presence.ts";
import {
  MAX_LINE_LENGTH,
  MIN_LINE_LENGTH,
  type Precision,
} from "#lib/shared/instance-settings.ts";
import { DETECT_LANGUAGE, LANGUAGE_TAG } from "#lib/shared/languages.ts";
import {
  DEFAULT_MAX_LINE_LENGTH,
  MAX_BATCH_SIZE,
  MAX_PROMPT_LENGTH,
} from "#lib/shared/limits.ts";
import {
  acceptsOption,
  parseModelKey,
} from "#lib/shared/transcription-models.ts";

type TranscriptionOptions = {
  alignment?: boolean;
  maxLineLength?: number;
  batchSize?: number;
  precision?: Precision;
  prompt?: string;
};

export type TranscriptionRequest = {
  adapterId: string;
  modelId: string;
  language: string | null;
  // Null transcribes the first audio track.
  audioTrack: number | null;
  options: TranscriptionOptions;
};

export function parseTranscriptionRequest(
  values: FormData,
): TranscriptionRequest {
  const model = parseModelKey(String(values.get("model") ?? ""));
  const language = String(values.get("language") ?? DETECT_LANGUAGE).trim();
  const batchSizeValue = String(values.get("batchSize") ?? "").trim();
  const maxLineLength = Number(
    String(values.get("maxLineLength") ?? DEFAULT_MAX_LINE_LENGTH).trim(),
  );
  const prompt = String(values.get("prompt") ?? "").trim();
  const audioTrackValue = String(values.get("audioTrack") ?? "").trim();
  const audioTrack = audioTrackValue ? Number(audioTrackValue) : null;

  if (!model) {
    throw badRequest("Choose an available transcription model.");
  }
  if (language !== DETECT_LANGUAGE && !LANGUAGE_TAG.test(language)) {
    throw badRequest("Choose a valid transcription language.");
  }
  const batchSize = batchSizeValue ? Number(batchSizeValue) : undefined;
  if (
    batchSize !== undefined &&
    (!Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_BATCH_SIZE)
  ) {
    throw badRequest(`Batch size must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  if (
    !Number.isInteger(maxLineLength) ||
    maxLineLength < MIN_LINE_LENGTH ||
    maxLineLength > MAX_LINE_LENGTH
  ) {
    throw badRequest(
      `Maximum line length must be between ${MIN_LINE_LENGTH} and ${MAX_LINE_LENGTH} characters.`,
    );
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw badRequest(
      `The prompt can be at most ${MAX_PROMPT_LENGTH} characters.`,
    );
  }
  if (
    audioTrack !== null &&
    (!Number.isInteger(audioTrack) || audioTrack < 0)
  ) {
    throw badRequest("Choose a valid audio track.");
  }

  return {
    ...model,
    language: language === DETECT_LANGUAGE ? null : language,
    audioTrack,
    options: {
      alignment: values.get("alignment") === "on",
      maxLineLength,
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(prompt ? { prompt } : {}),
    },
  };
}

export async function enqueueTranscription(
  projectId: string,
  userId: string,
  request: TranscriptionRequest,
): Promise<string> {
  return withTransaction((tx) => {
    const project = projectForUser(tx, projectId, userId);
    if (!project) throw notFound("Project not found.");
    const sourceStorageKey = project.mediaOriginalKey;
    if (!sourceStorageKey) {
      throw conflict("The source upload is not complete yet.");
    }

    if (hasActiveTranscriptionRun(tx, project.id)) {
      throw conflict("This project is already being transcribed.");
    }

    const { precision } = readInstanceSettings(tx);
    const model = transcriptionModelChoices(
      tx,
      activeWorkerManifests(tx),
      precision,
    ).find(
      (candidate) =>
        candidate.adapterId === request.adapterId &&
        candidate.modelId === request.modelId,
    );
    if (!model) {
      throw conflict("That model is not available on a connected worker.");
    }
    // Precision is the administrator's choice, so it applies to every run of
    // an adapter that offers it. A remote model takes only the options its
    // schema lists, without alignment or batch size.
    const options: TranscriptionOptions = model.remote
      ? remoteOptions(model.optionsSchema, request.options)
      : acceptsOption(model.optionsSchema, "precision")
        ? { ...request.options, precision }
        : request.options;

    const audioTrack = request.audioTrack ?? 0;
    prepareTranscriptAudio(tx, { ...project, sourceStorageKey }, audioTrack);

    const run = tx
      .insert(transcriptionRuns)
      .values({
        projectId: project.id,
        adapterId: request.adapterId,
        modelId: request.modelId,
        options,
        createdBy: userId,
      })
      .returning({ id: transcriptionRuns.id })
      .get();
    const payload: TranscriptionJobPayload = {
      kind: "transcribe",
      adapterId: request.adapterId,
      modelId: request.modelId,
      projectId: project.id,
      runId: run.id,
      mediaPath: resolveDataPath(sourceStorageKey),
      ...(request.language === null ? {} : { language: request.language }),
      options,
      audioTrack,
    };
    tx.insert(jobs)
      .values({
        workspaceId: project.workspaceId,
        projectId: project.id,
        runId: run.id,
        kind: "transcribe",
        payload,
      })
      .run();
    return run.id;
  });
}

function remoteOptions(
  optionsSchema: Record<string, unknown>,
  options: TranscriptionOptions,
): TranscriptionOptions {
  return Object.fromEntries(
    Object.entries(options).filter(([name]) =>
      acceptsOption(optionsSchema, name),
    ),
  );
}
