import { randomUUID } from "node:crypto";

import type {
  AdapterModel,
  TranslationJobCompletion,
  TranslationJobPayload,
  WorkerManifest,
} from "@anysub/contracts";
import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "#lib/server/db/index.ts";
import { cues, jobs, subtitleTracks } from "#lib/server/db/schema.ts";
import { seedProject, seedTrack } from "#lib/server/db/testing/fixtures.ts";
import {
  connectWorker,
  remoteWorker,
  TEST_API_KEY,
} from "#lib/server/db/testing/remote.ts";
import { completeJob } from "#lib/server/jobs/completion.ts";
import { leaseJob } from "#lib/server/jobs/lease.ts";
import {
  readInstanceSettings,
  updateInstanceSettings,
} from "#lib/server/settings/instance.ts";
import { insertCues } from "#lib/server/subtitles/cues.ts";
import { listProjectTracks } from "#lib/server/subtitles/tracks.ts";
import { deleteTranscriptForUser } from "#lib/server/subtitles/transcripts.ts";
import {
  adminProviders,
  createProvider,
  deleteProvider,
} from "#lib/server/transcription/providers.ts";
import {
  enqueueTranslations,
  type TranslationRequest,
} from "#lib/server/translation/enqueue.ts";
import { toChoice, translationModels } from "#lib/server/translation/models.ts";
import {
  cancelTranslationsForUser,
  dismissTranslationForUser,
  translationTasks,
} from "#lib/server/translation/tasks.ts";
import { activeWorkerManifests } from "#lib/server/workers/presence.ts";
import { PROVIDER_TRANSLATION } from "#lib/shared/translation.ts";
import { REMOTE_ADAPTER_ID } from "#lib/shared/transcription-models.ts";

const LOCAL_KEY = "madlad:madlad-400-3b";

function translatingWorker(downloaded: boolean): WorkerManifest {
  const model: AdapterModel = {
    id: "madlad-400-3b",
    displayName: "MADLAD-400 3B",
    capabilities: ["translate"],
    languages: "all",
    description: "Translates on this server.",
    parameterCount: null,
    requiredVramBytes: null,
    recommendedRamBytes: null,
    downloadSizeBytes: null,
    downloaded,
    optionsSchema: {},
  };
  const manifest = remoteWorker(true);
  return {
    ...manifest,
    capabilities: { ...manifest.capabilities, translation: "1.0" },
    adapters: [
      {
        protocolVersion: "1.1",
        id: "madlad",
        displayName: "MADLAD-400",
        version: "1.0.0",
        description: null,
        models: [model],
      },
    ],
  };
}

function seedProvider(): string {
  createProvider(
    {
      name: "OpenAI",
      baseUrl: "https://api.openai.test/v1",
      apiKey: TEST_API_KEY,
    },
    [],
  );
  const provider = adminProviders(db).find((row) => row.name === "OpenAI");
  if (!provider) throw new Error("Expected a provider");
  updateInstanceSettings({
    translationProviderId: provider.id,
    translationModel: "gpt-test",
  });
  return provider.id;
}

function seedTranscript(projectId: string): string {
  const trackId = seedTrack(projectId);
  db.update(subtitleTracks)
    .set({ revision: 4 })
    .where(eq(subtitleTracks.id, trackId))
    .run();
  insertCues(db, trackId, {
    ids: "generate",
    cues: [
      { startUs: 2_000_000, endUs: 3_000_000, text: "World.", words: [] },
      { startUs: 0, endUs: 1_000_000, text: "Hello", words: [] },
      { startUs: 1_000_000, endUs: 2_000_000, text: "  ", words: [] },
    ],
  });
  return trackId;
}

function request(
  sourceTrackId: string,
  changes: Partial<TranslationRequest> = {},
): TranslationRequest {
  return {
    sourceTrackId,
    targetLanguages: ["es"],
    modelKey: LOCAL_KEY,
    ...changes,
  };
}

function translationJob(jobId: string) {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) throw new Error("Expected a job");
  return { ...job, payload: job.payload as TranslationJobPayload };
}

describe("translationModels", () => {
  it("offers a downloaded local model, after the provider's when one is set", () => {
    connectWorker(translatingWorker(true));
    expect(translationModels(db, activeWorkerManifests(db))).toEqual([
      expect.objectContaining({
        key: LOCAL_KEY,
        displayName: "MADLAD-400 3B",
        downloaded: true,
        remote: null,
      }),
    ]);

    seedProvider();
    const models = translationModels(db, activeWorkerManifests(db));
    expect(models.map(({ key }) => key)).toEqual([
      PROVIDER_TRANSLATION,
      LOCAL_KEY,
    ]);
    expect(models[0]).toMatchObject({
      displayName: "gpt-test",
      remote: { providerName: "OpenAI", host: "api.openai.test" },
    });
    expect(models[0]?.remote).not.toHaveProperty("priceMicrosPerMinute");
  });

  it("sends the studio only what its model picker shows", () => {
    connectWorker(translatingWorker(true));
    seedProvider();
    const [provider] = translationModels(db, activeWorkerManifests(db));
    if (!provider) throw new Error("Expected the provider's model");
    expect(toChoice(provider)).not.toHaveProperty("providerId");
    expect(toChoice(provider)).not.toHaveProperty("modelId");
  });

  it("offers nothing without a worker that translates", () => {
    expect(translationModels(db, [remoteWorker(true)])).toEqual([]);
    expect(
      translationModels(db, [translatingWorker(false)]).map(({ key }) => key),
    ).not.toContain(LOCAL_KEY);
  });
});

describe("enqueueTranslations", () => {
  it("queues one job per language with the saved cues in time order", () => {
    connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);

    const jobIds = enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId, { targetLanguages: ["es", "de"] }),
    );

    expect(jobIds).toHaveLength(2);
    const { payload, kind, projectId } = translationJob(jobIds[0] ?? "");
    expect(kind).toBe("translate");
    expect(projectId).toBe(project.projectId);
    expect(payload).toMatchObject({
      adapterId: "madlad",
      modelId: "madlad-400-3b",
      modelName: "MADLAD-400 3B",
      sourceTrackId: trackId,
      sourceRevision: 4,
      sourceLanguage: "en",
      targetLanguage: "es",
      sourceLanguageName: "English",
      targetLanguageName: "Spanish",
      maxLineLength: 42,
    });
    expect(payload.cues.map((cue) => cue.text)).toEqual(["Hello", "World."]);
    expect(translationJob(jobIds[1] ?? "").payload.targetLanguage).toBe("de");
  });

  it("refuses the transcript's own language, a busy language and a missing model", () => {
    connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    const translate = (changes: Partial<TranslationRequest>) => () =>
      enqueueTranslations(
        project.projectId,
        project.userId,
        request(trackId, changes),
      );

    expect(translate({ targetLanguages: ["en"] })).toThrow(
      /already in English/,
    );
    expect(translate({ modelKey: "madlad:other" })).toThrow(/not available/);
    translate({})();
    expect(translate({ targetLanguages: ["fr", "es"] })).toThrow(
      /already being translated into Spanish/,
    );
  });

  it("refuses a translation as the source", () => {
    connectWorker(translatingWorker(true));
    const project = seedProject();
    const sourceId = seedTranscript(project.projectId);
    const translatedId = seedTranscript(project.projectId);
    db.update(subtitleTracks)
      .set({
        kind: "translation",
        metadata: {
          translation: {
            jobId: randomUUID(),
            sourceTrackId: sourceId,
            sourceRevision: 4,
            sourceLanguage: "en",
            modelLabel: "MADLAD-400 3B",
            local: true,
          },
        },
      })
      .where(eq(subtitleTracks.id, translatedId))
      .run();

    expect(() =>
      enqueueTranslations(
        project.projectId,
        project.userId,
        request(translatedId, { targetLanguages: ["de"] }),
      ),
    ).toThrow(/from the original transcript/);
  });

  it("replaces a failed translation when that language is tried again", () => {
    connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    const failed = enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId, { targetLanguages: ["es", "de"] }),
    );
    db.update(jobs)
      .set({
        state: "failed",
        error: { code: "x", message: "No.", retryable: false },
      })
      .where(inArray(jobs.id, failed))
      .run();

    const [retry] = enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId),
    );

    expect(
      translationTasks(db, project.projectId).map(({ jobId, state }) => [
        jobId,
        state,
      ]),
    ).toEqual([
      [failed[1], "failed"],
      [retry, "queued"],
    ]);
  });

  it("refuses an empty transcript and someone outside the workspace", () => {
    connectWorker(translatingWorker(true));
    const project = seedProject();
    const emptyTrack = seedTrack(project.projectId);
    const stranger = seedProject();
    const trackId = seedTranscript(project.projectId);

    expect(() =>
      enqueueTranslations(
        project.projectId,
        project.userId,
        request(emptyTrack),
      ),
    ).toThrow(/no text/);
    expect(() =>
      enqueueTranslations(project.projectId, stranger.userId, request(trackId)),
    ).toThrow(/not found/);
  });
});

describe("leasing a translation", () => {
  it("goes to a worker with the adapter, and a provider's job carries its key", async () => {
    const worker = connectWorker(translatingWorker(true));
    seedProvider();
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId, { modelKey: PROVIDER_TRANSLATION }),
    );

    expect(await leaseJob(remoteWorker(true))).toBeNull();
    const lease = await leaseJob(worker);

    expect(lease?.payload).toMatchObject({
      kind: "translate",
      adapterId: REMOTE_ADAPTER_ID,
      modelId: "gpt-test",
    });
    expect(lease?.remote).toEqual({
      providerName: "OpenAI",
      baseUrl: "https://api.openai.test/v1",
      apiKey: TEST_API_KEY,
      model: "gpt-test",
    });
  });

  it("fails when the provider was deleted, which also clears the setting", async () => {
    const worker = connectWorker(translatingWorker(true));
    const providerId = seedProvider();
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    const [jobId] = enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId, { modelKey: PROVIDER_TRANSLATION }),
    );

    deleteProvider(providerId);

    expect(readInstanceSettings(db)).toMatchObject({
      translationProviderId: null,
      translationModel: null,
    });
    expect(await leaseJob(worker)).toBeNull();
    expect(translationJob(jobId ?? "").state).toBe("failed");
  });
});

describe("local translation jobs", () => {
  it("go only to a worker that downloaded the model", async () => {
    const ready = translatingWorker(true);
    const missing = connectWorker(translatingWorker(false));
    connectWorker(ready);
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    enqueueTranslations(project.projectId, project.userId, request(trackId));

    expect(await leaseJob(missing)).toBeNull();
    expect((await leaseJob(ready))?.payload.kind).toBe("translate");
  });

  it("are cancelled when their source transcript is deleted", () => {
    connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    const [jobId] = enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId),
    );

    expect(
      deleteTranscriptForUser(project.projectId, trackId, project.userId),
    ).toBe(true);
    expect(translationJob(jobId ?? "").state).toBe("cancelled");
  });
});

describe("completing a translation", () => {
  it("adds a translated transcript that remembers its source", async () => {
    const worker = connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    const [jobId] = enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId),
    );
    const lease = await leaseJob(worker);
    if (!lease) throw new Error("Expected a lease");
    const completion: TranslationJobCompletion = {
      kind: "translate",
      language: "es",
      cues: [
        { startUs: 0, endUs: 1_000_000, text: "Hola" },
        { startUs: 2_000_000, endUs: 3_000_000, text: "Mundo." },
      ],
      adapter: { id: "madlad", version: "1.0.0", modelId: "madlad-400-3b" },
    };

    expect(await completeJob(lease.jobId, lease.leaseToken, completion)).toBe(
      "completed",
    );

    const translated = listProjectTracks(db, project.projectId).find(
      (track) => track.language === "es",
    );
    expect(translated).toMatchObject({
      name: "Translation · MADLAD-400 3B",
      madeBy: jobId,
      modelKey: LOCAL_KEY,
      translatedFrom: { trackId, revision: 4 },
      cueCount: 2,
    });
    const row = db
      .select()
      .from(subtitleTracks)
      .where(eq(subtitleTracks.id, translated?.id ?? ""))
      .get();
    expect(row?.kind).toBe("translation");
    expect(row?.metadata.translation).toEqual({
      jobId,
      sourceTrackId: trackId,
      sourceRevision: 4,
      sourceLanguage: "en",
      modelLabel: "MADLAD-400 3B",
      local: true,
    });
    expect(
      db
        .select({ text: cues.text })
        .from(cues)
        .where(eq(cues.trackId, translated?.id ?? ""))
        .orderBy(asc(cues.position))
        .all()
        .map(({ text }) => text),
    ).toEqual(["Hola", "Mundo."]);
    expect(translationTasks(db, project.projectId)).toEqual([]);
  });

  it("refuses a language other than the one asked for", async () => {
    const worker = connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    enqueueTranslations(project.projectId, project.userId, request(trackId));
    const lease = await leaseJob(worker);
    if (!lease) throw new Error("Expected a lease");

    await expect(
      completeJob(lease.jobId, lease.leaseToken, {
        kind: "translate",
        language: "fr",
        cues: [{ startUs: 0, endUs: 1_000_000, text: "Bonjour" }],
        adapter: { id: "madlad", version: "1.0.0", modelId: "madlad-400-3b" },
      }),
    ).rejects.toThrow(/does not match/);
  });

  it("refuses cues out of order", async () => {
    const worker = connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    enqueueTranslations(project.projectId, project.userId, request(trackId));
    const lease = await leaseJob(worker);
    if (!lease) throw new Error("Expected a lease");

    await expect(
      completeJob(lease.jobId, lease.leaseToken, {
        kind: "translate",
        language: "es",
        cues: [
          { startUs: 2_000_000, endUs: 3_000_000, text: "Mundo." },
          { startUs: 0, endUs: 1_000_000, text: "Hola" },
        ],
        adapter: { id: "madlad", version: "1.0.0", modelId: "madlad-400-3b" },
      }),
    ).rejects.toThrow(/not in order/);
  });
});

describe("translation tasks", () => {
  it("lists running ones, cancels them, and dismisses only failed ones", () => {
    connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    const [running, failing] = enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId, { targetLanguages: ["es", "de"] }),
    );
    db.update(jobs)
      .set({
        state: "failed",
        error: { code: "x", message: "No.", retryable: false },
      })
      .where(eq(jobs.id, failing ?? ""))
      .run();

    expect(
      translationTasks(db, project.projectId).map(
        ({ targetLanguage, state, error }) => [targetLanguage, state, error],
      ),
    ).toEqual([
      ["es", "queued", null],
      ["de", "failed", "No."],
    ]);

    expect(
      dismissTranslationForUser(
        project.projectId,
        running ?? "",
        project.userId,
      ),
    ).toBe(false);
    expect(
      cancelTranslationsForUser(
        project.projectId,
        [running ?? ""],
        project.userId,
      ),
    ).toBe(true);
    expect(
      dismissTranslationForUser(
        project.projectId,
        failing ?? "",
        project.userId,
      ),
    ).toBe(true);
    expect(translationTasks(db, project.projectId)).toEqual([]);
    expect(
      cancelTranslationsForUser(
        project.projectId,
        [randomUUID()],
        project.userId,
      ),
    ).toBe(false);
  });

  it("cancels several waiting ones at once", () => {
    connectWorker(translatingWorker(true));
    const project = seedProject();
    const trackId = seedTranscript(project.projectId);
    const [spanish, german, french] = enqueueTranslations(
      project.projectId,
      project.userId,
      request(trackId, { targetLanguages: ["es", "de", "fr"] }),
    );

    expect(
      cancelTranslationsForUser(
        project.projectId,
        [spanish ?? "", german ?? ""],
        project.userId,
      ),
    ).toBe(true);
    expect(
      translationTasks(db, project.projectId).map(({ jobId }) => jobId),
    ).toEqual([french]);
  });
});
