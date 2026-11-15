import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";

import { jobs, projects } from "#lib/server/db/schema.ts";
import { hashToken } from "#lib/server/jobs/lease-token.ts";
import { ACTIVE_JOB_STATES } from "#lib/shared/project-status.ts";

type PayloadField = "adapterId" | "workerId";

export const isMediaPrepareJob = eq(jobs.kind, "media_prepare");
export const isActiveJob = inArray(jobs.state, ACTIVE_JOB_STATES);

// Jobs queued before a track could be chosen built the first one.
export const preparationAudioTrack = sql<number>`coalesce(${jobs.payload} ->> 'audioTrack', 0)`;

// The project's preparation status follows its jobs until the file has been
// read. After that each audio track reports its own preparation.
export const isUnreadMedia = ne(projects.mediaPreparationStatus, "completed");

export function payloadField(field: PayloadField) {
  return sql<string>`${jobs.payload} ->> ${field}`;
}

export function holdsActiveLease(leaseToken: string, now = new Date()) {
  return and(
    eq(jobs.state, "leased"),
    eq(jobs.leaseTokenHash, hashToken(leaseToken)),
    gt(jobs.leaseExpiresAt, now),
  );
}

// Each worker keeps its own model cache, so a model job belongs to the worker
// it names and only that worker may lease it.
export function isModelCacheJobOf(workerId: string) {
  return and(
    eq(jobs.kind, "model_cache"),
    eq(payloadField("workerId"), workerId),
  );
}
