import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import { jobs } from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import { payloadField } from "#lib/server/jobs/predicates.ts";
import { cancelActiveJobs } from "#lib/server/jobs/release.ts";
import { projectForUser } from "#lib/server/projects/access.ts";
import type { TranslationTask } from "#lib/shared/translation.ts";

const SHOWN_STATES = ["queued", "leased", "failed"] as const;

// Running translations, and failed ones until someone dismisses them.
export function translationTasks(
  executor: Executor,
  projectId: string,
): TranslationTask[] {
  return (
    executor
      .select({
        jobId: jobs.id,
        state: jobs.state,
        // Read on their own, since the payload holds the whole transcript.
        sourceTrackId: payloadField("sourceTrackId"),
        targetLanguage: payloadField("targetLanguage"),
        progress: jobs.progress,
        progressMessage: jobs.progressMessage,
        error: jobs.error,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, projectId),
          eq(jobs.kind, "translate"),
          inArray(jobs.state, SHOWN_STATES),
        ),
      )
      // Jobs queued together share a moment, so insertion order breaks the tie.
      .orderBy(asc(jobs.createdAt), asc(sql`${jobs}.rowid`))
      .all()
      .map(({ error, state, ...job }) => ({
        ...job,
        state: state as TranslationTask["state"],
        error: error?.message ?? null,
      }))
  );
}

export function cancelTranslationsForUser(
  projectId: string,
  jobIds: string[],
  userId: string,
): boolean {
  return withTransaction((tx) => {
    if (!projectForUser(tx, projectId, userId)) return false;
    return cancelActiveJobs(tx, translationJobs(projectId, jobIds)).length > 0;
  });
}

export function dismissTranslationForUser(
  projectId: string,
  jobId: string,
  userId: string,
): boolean {
  return withTransaction((tx) => {
    if (!projectForUser(tx, projectId, userId)) return false;
    const removed = tx
      .delete(jobs)
      .where(and(translationJobs(projectId, [jobId]), eq(jobs.state, "failed")))
      .returning({ id: jobs.id })
      .all();
    return removed.length > 0;
  });
}

function translationJobs(projectId: string, jobIds: string[]) {
  return and(
    inArray(jobs.id, jobIds),
    eq(jobs.projectId, projectId),
    eq(jobs.kind, "translate"),
  );
}
