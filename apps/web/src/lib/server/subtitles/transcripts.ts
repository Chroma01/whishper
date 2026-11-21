import { and, eq } from "drizzle-orm";

import {
  jobs,
  subtitleTracks,
  transcriptionRuns,
} from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import { payloadField } from "#lib/server/jobs/predicates.ts";
import { cancelActiveJobs } from "#lib/server/jobs/release.ts";
import { manageableProjectForUser } from "#lib/server/projects/access.ts";

export function deleteTranscriptForUser(
  projectId: string,
  trackId: string,
  userId: string,
): boolean {
  return withTransaction((tx) => {
    if (!manageableProjectForUser(tx, projectId, userId)) return false;
    const track = tx
      .delete(subtitleTracks)
      .where(
        and(
          eq(subtitleTracks.id, trackId),
          eq(subtitleTracks.projectId, projectId),
        ),
      )
      .returning({ sourceRunId: subtitleTracks.sourceRunId })
      .get();
    if (!track) return false;
    // A translation finishing later would point at a transcript that is gone.
    cancelActiveJobs(
      tx,
      and(
        eq(jobs.kind, "translate"),
        eq(payloadField("sourceTrackId"), trackId),
      ),
    );
    if (track.sourceRunId) {
      tx.delete(transcriptionRuns)
        .where(eq(transcriptionRuns.id, track.sourceRunId))
        .run();
    }
    return true;
  });
}
