import {
  MEDIA_PREPARATION_VERSION,
  MODEL_CACHE_VERSION,
  type RemoteModelAccess,
  type WorkerJobPayload,
  type WorkerLease,
  type WorkerManifest,
} from "@anysub/contracts";
import { and, asc, desc, eq, inArray, lte, or } from "drizzle-orm";

import {
  jobs,
  projects,
  transcriptionRuns,
  workers,
  type StoredJobError,
} from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import {
  cleanupReclaimedArtifacts,
  failUnleasableJob,
  reclaimExpiredLeases,
} from "#lib/server/jobs/failure.ts";
import { generateLeaseToken, hashToken } from "#lib/server/jobs/lease-token.ts";
import {
  holdsActiveLease,
  isMediaPrepareJob,
  isUnreadMedia,
  isModelCacheJobOf,
  payloadField,
} from "#lib/server/jobs/predicates.ts";
import type { Executor } from "#lib/server/db/index.ts";
import { supportsRemoteTranscription } from "#lib/server/transcription/models.ts";
import { remoteModelAccess } from "#lib/server/transcription/providers.ts";
import {
  supportsTranslation,
  translationModelAccess,
} from "#lib/server/translation/models.ts";
import { recordWorkerPresence } from "#lib/server/workers/presence.ts";
import { REMOTE_ADAPTER_ID } from "#lib/shared/transcription-models.ts";

const LEASE_MS = 60_000;
export const WORKER_POLL_INTERVAL_MS = 2_000;
const REMOVED_REMOTE_MODEL: StoredJobError = {
  code: "remote_model_removed",
  message:
    "An administrator removed this provider's model before the transcription started. Choose another model.",
  retryable: false,
};
const REMOVED_TRANSLATION_PROVIDER: StoredJobError = {
  code: "remote_model_removed",
  message:
    "An administrator removed this provider before the translation started. Choose another model.",
  retryable: false,
};

type RemoteAccess =
  | { needed: false }
  | { needed: true; access: RemoteModelAccess | null; removed: StoredJobError };

function remoteAccess(
  executor: Executor,
  payload: WorkerJobPayload,
): RemoteAccess {
  if (
    payload.kind === "transcribe" &&
    payload.adapterId === REMOTE_ADAPTER_ID
  ) {
    return {
      needed: true,
      access: remoteModelAccess(executor, payload.modelId),
      removed: REMOVED_REMOTE_MODEL,
    };
  }
  if (payload.kind === "translate" && payload.adapterId === REMOTE_ADAPTER_ID) {
    return {
      needed: true,
      access: payload.providerId
        ? translationModelAccess(executor, payload.providerId, payload.modelId)
        : null,
      removed: REMOVED_TRANSLATION_PROVIDER,
    };
  }
  return { needed: false };
}

export async function leaseJob(
  manifest: WorkerManifest,
): Promise<WorkerLease | null> {
  const adapterIds = manifest.adapters.map((adapter) => adapter.id);
  const supportsMediaPreparation =
    manifest.capabilities.mediaPreparation === MEDIA_PREPARATION_VERSION;
  const supportsModelCache =
    manifest.capabilities.modelCache === MODEL_CACHE_VERSION &&
    adapterIds.length > 0;
  const supportsRemote = supportsRemoteTranscription(manifest);
  const translates = supportsTranslation(manifest);
  const { lease, reclaimed } = withTransaction((tx) => {
    recordWorkerPresence(tx, manifest);
    const reclaimed = reclaimExpiredLeases(tx);

    const offeredAdapter = inArray(payloadField("adapterId"), adapterIds);
    const compatible = [
      ...(adapterIds.length > 0
        ? [and(eq(jobs.kind, "transcribe"), offeredAdapter)]
        : []),
      ...(supportsRemote
        ? [
            and(
              eq(jobs.kind, "transcribe"),
              eq(payloadField("adapterId"), REMOTE_ADAPTER_ID),
            ),
          ]
        : []),
      ...(translates
        ? [
            and(
              eq(jobs.kind, "translate"),
              or(
                eq(payloadField("adapterId"), REMOTE_ADAPTER_ID),
                ...downloadedTranslationModels(manifest).map((model) =>
                  and(
                    eq(payloadField("adapterId"), model.adapterId),
                    eq(payloadField("modelId"), model.modelId),
                  ),
                ),
              ),
            ),
          ]
        : []),
      ...(supportsMediaPreparation ? [isMediaPrepareJob] : []),
      ...(supportsModelCache
        ? [and(isModelCacheJobOf(manifest.workerId), offeredAdapter)]
        : []),
    ];
    if (compatible.length === 0) return { lease: null, reclaimed };

    const now = new Date();
    const job = tx
      .select({ id: jobs.id, attempts: jobs.attempts, payload: jobs.payload })
      .from(jobs)
      .where(
        and(
          eq(jobs.state, "queued"),
          lte(jobs.availableAt, now),
          or(...compatible),
        ),
      )
      .orderBy(desc(jobs.priority), asc(jobs.createdAt))
      .limit(1)
      .get();
    if (!job) return { lease: null, reclaimed };

    const required = remoteAccess(tx, job.payload);
    const remote = required.needed ? required.access : null;
    if (required.needed && !remote) {
      failUnleasableJob(tx, job.id, job.payload, required.removed);
      return { lease: null, reclaimed };
    }

    const leaseToken = generateLeaseToken();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    tx.update(jobs)
      .set({
        state: "leased",
        leasedBy: manifest.workerId,
        leaseTokenHash: hashToken(leaseToken),
        leaseExpiresAt,
        attempts: job.attempts + 1,
      })
      .where(eq(jobs.id, job.id))
      .run();
    if (job.payload.kind === "transcribe") {
      tx.update(transcriptionRuns)
        .set({ status: "running" })
        .where(
          and(
            eq(transcriptionRuns.id, job.payload.runId),
            eq(transcriptionRuns.status, "queued"),
          ),
        )
        .run();
    } else if (job.payload.kind === "media_prepare") {
      tx.update(projects)
        .set({ mediaPreparationStatus: "running" })
        .where(and(eq(projects.id, job.payload.projectId), isUnreadMedia))
        .run();
    }

    return {
      lease: {
        jobId: job.id,
        attempt: job.attempts + 1,
        leaseToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        payload: job.payload,
        ...(remote && { remote }),
      },
      reclaimed,
    };
  });
  await cleanupReclaimedArtifacts(reclaimed);
  return lease;
}

// A local model translates only on a worker that has it, so a worker never
// starts a large download inside someone's translation.
function downloadedTranslationModels(
  manifest: WorkerManifest,
): { adapterId: string; modelId: string }[] {
  return manifest.adapters.flatMap((adapter) =>
    adapter.models
      .filter(
        (model) =>
          model.capabilities.includes("translate") && model.downloaded === true,
      )
      .map((model) => ({ adapterId: adapter.id, modelId: model.id })),
  );
}

export function reportProgress(
  jobId: string,
  leaseToken: string,
  progress: number,
  message: string,
): boolean {
  return withTransaction((tx) => {
    const now = new Date();
    const job = tx
      .update(jobs)
      .set({
        progress,
        progressMessage: message,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(and(eq(jobs.id, jobId), holdsActiveLease(leaseToken, now)))
      .returning({ leasedBy: jobs.leasedBy })
      .get();
    if (!job) return false;
    if (job.leasedBy) {
      tx.update(workers)
        .set({ lastSeenAt: now })
        .where(eq(workers.id, job.leasedBy))
        .run();
    }
    return true;
  });
}
