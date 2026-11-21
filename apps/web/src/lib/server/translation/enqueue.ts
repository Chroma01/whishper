import type { TranslationJobPayload } from "@anysub/contracts";
import { and, eq } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import { jobs } from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import { badRequest, conflict, notFound } from "#lib/server/http/errors.ts";
import { isActiveJob, payloadField } from "#lib/server/jobs/predicates.ts";
import { projectForUser } from "#lib/server/projects/access.ts";
import { listTrackCues } from "#lib/server/subtitles/cues.ts";
import { trackForProject } from "#lib/server/subtitles/tracks.ts";
import { translationModels } from "#lib/server/translation/models.ts";
import { activeWorkerManifests } from "#lib/server/workers/presence.ts";
import { clamp } from "#lib/shared/clamp.ts";
import {
  MAX_LINE_LENGTH,
  MIN_LINE_LENGTH,
} from "#lib/shared/instance-settings.ts";
import { LANGUAGE_TAG, languageName } from "#lib/shared/languages.ts";
import { DEFAULT_MAX_LINE_LENGTH } from "#lib/shared/limits.ts";
import {
  MAX_TARGET_LANGUAGES,
  MAX_TRANSLATION_CHARACTERS,
  translationOrigin,
} from "#lib/shared/translation.ts";
import { isUuid } from "#lib/shared/uuid.ts";

export type TranslationRequest = {
  sourceTrackId: string;
  targetLanguages: string[];
  modelKey: string;
};

export function parseTranslationRequest(form: FormData): TranslationRequest {
  const sourceTrackId = String(form.get("sourceTrackId") ?? "");
  const modelKey = String(form.get("model") ?? "");
  const targetLanguages = [
    ...new Set(
      form.getAll("targetLanguage").map((value) => String(value).trim()),
    ),
  ];
  if (!isUuid(sourceTrackId)) throw badRequest("Choose a transcript.");
  if (!modelKey) throw badRequest("Choose a translation model.");
  if (targetLanguages.length === 0) {
    throw badRequest("Choose at least one language.");
  }
  if (targetLanguages.length > MAX_TARGET_LANGUAGES) {
    throw badRequest(
      `Choose at most ${MAX_TARGET_LANGUAGES} languages at a time.`,
    );
  }
  if (!targetLanguages.every((language) => LANGUAGE_TAG.test(language))) {
    throw badRequest("Choose languages from the list.");
  }
  return { sourceTrackId, targetLanguages, modelKey };
}

export function enqueueTranslations(
  projectId: string,
  userId: string,
  request: TranslationRequest,
): string[] {
  return withTransaction((tx) => {
    const project = projectForUser(tx, projectId, userId);
    if (!project) throw notFound("Project not found.");
    const track = trackForProject(tx, project.id, request.sourceTrackId);
    if (!track) throw notFound("That transcript no longer exists.");
    // Each hop adds mistakes, so a translation never becomes a source.
    if (translationOrigin(track.metadata)) {
      throw badRequest(
        "Translate from the original transcript, not from a translation.",
      );
    }
    const model = translationModels(tx, activeWorkerManifests(tx)).find(
      (candidate) => candidate.key === request.modelKey,
    );
    if (!model) {
      throw conflict(
        "That translation model is not available on a connected worker.",
      );
    }
    if (request.targetLanguages.includes(track.language)) {
      throw badRequest(
        `The transcript is already in ${languageName(track.language)}.`,
      );
    }
    const busy = request.targetLanguages.find((language) =>
      isTranslating(tx, track.id, language),
    );
    if (busy) {
      throw conflict(
        `It is already being translated into ${languageName(busy)}.`,
      );
    }
    const cues = listTrackCues(tx, track.id)
      .filter((cue) => cue.text.trim())
      .sort((left, right) => left.startUs - right.startUs)
      .map(({ startUs, endUs, text }) => ({ startUs, endUs, text }));
    if (cues.length === 0) {
      throw conflict("The transcript has no text to translate.");
    }
    const characters = cues.reduce((sum, cue) => sum + cue.text.length, 0);
    if (characters > MAX_TRANSLATION_CHARACTERS) {
      throw conflict(
        `The transcript is too long to translate at once: it has more than ${MAX_TRANSLATION_CHARACTERS.toLocaleString("en")} characters.`,
      );
    }
    const maxLineLength = clamp(
      Number(track.metadata.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH) ||
        DEFAULT_MAX_LINE_LENGTH,
      MIN_LINE_LENGTH,
      MAX_LINE_LENGTH,
    );

    return request.targetLanguages.map((targetLanguage) => {
      // Trying again replaces the failure it answers.
      tx.delete(jobs)
        .where(
          and(
            translationJobsFor(track.id, targetLanguage),
            eq(jobs.state, "failed"),
          ),
        )
        .run();
      const payload: TranslationJobPayload = {
        kind: "translate",
        adapterId: model.adapterId,
        modelId: model.modelId,
        modelName: model.displayName,
        providerId: model.providerId,
        projectId: project.id,
        sourceTrackId: track.id,
        sourceRevision: track.revision,
        sourceLanguage: track.language,
        targetLanguage,
        sourceLanguageName: languageName(track.language),
        targetLanguageName: languageName(targetLanguage),
        maxLineLength,
        cues,
      };
      return tx
        .insert(jobs)
        .values({
          workspaceId: project.workspaceId,
          projectId: project.id,
          kind: "translate",
          payload,
        })
        .returning({ id: jobs.id })
        .get().id;
    });
  });
}

function isTranslating(
  executor: Executor,
  sourceTrackId: string,
  targetLanguage: string,
): boolean {
  return (
    executor
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(translationJobsFor(sourceTrackId, targetLanguage), isActiveJob),
      )
      .limit(1)
      .get() !== undefined
  );
}

function translationJobsFor(sourceTrackId: string, targetLanguage: string) {
  return and(
    eq(jobs.kind, "translate"),
    eq(payloadField("sourceTrackId"), sourceTrackId),
    eq(payloadField("targetLanguage"), targetLanguage),
  );
}
