import { requireUserOrLogin } from "#lib/server/auth/session.ts";
import { db } from "#lib/server/db/index.ts";
import { runFormAction } from "#lib/server/http/actions.ts";
import { removeAudioTrackCopyForUser } from "#lib/server/media/derivatives.ts";
import {
  cancelMediaPreparationForUser,
  requestMediaPreparationForUser,
} from "#lib/server/media/preparation.ts";
import { projectForUser } from "#lib/server/projects/access.ts";
import { deleteProjectForUser } from "#lib/server/projects/delete.ts";
import {
  latestMediaPreparations,
  latestRun,
  readyDerivatives,
  studioProject,
} from "#lib/server/projects/studio.ts";
import { readTranscriptionDefaults } from "#lib/server/settings/instance.ts";
import { listTrackCues } from "#lib/server/subtitles/cues.ts";
import {
  listProjectTracks,
  trackForProject,
} from "#lib/server/subtitles/tracks.ts";
import { deleteTranscriptForUser } from "#lib/server/subtitles/transcripts.ts";
import { cancelTranscriptionForUser } from "#lib/server/transcription/cancel.ts";
import {
  enqueueTranscription,
  parseTranscriptionRequest,
} from "#lib/server/transcription/enqueue.ts";
import {
  detectedWorkerHardware,
  transcriptionModelChoices,
} from "#lib/server/transcription/models.ts";
import { activeWorkerManifests } from "#lib/server/workers/presence.ts";
import { projectDerivativeUrl, projectPageUrl } from "#lib/shared/routes.ts";
import type { StudioData } from "#lib/shared/studio-data.ts";
import { isUuid } from "#lib/shared/uuid.ts";
import { error, fail, redirect, type ActionFailure } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({
  locals,
  params,
}): Promise<StudioData> => {
  const user = requireUserOrLogin(locals);
  const access = projectForUser(db, params.projectId, user.id);
  const project = access && studioProject(db, access.id);
  if (!access || !project) error(404, "Project not found");

  // The address names the open transcript, so a reload, a link or a form
  // action keeps it, and a new one finishing elsewhere does not replace it.
  const tracks = listProjectTracks(db, project.id);
  const newest = tracks.at(-1);
  if (!params.trackId && newest) {
    redirect(303, projectPageUrl(project.id, newest.id));
  }
  const track = params.trackId
    ? trackForProject(db, project.id, params.trackId)
    : null;
  if (params.trackId && !track) redirect(303, projectPageUrl(project.id));

  const run = latestRun(db, project.id);
  const preparations = latestMediaPreparations(db, project.id);
  const derivatives = readyDerivatives(db, project.id);
  const workerManifests = activeWorkerManifests(db);
  const transcriptionDefaults = readTranscriptionDefaults(db);
  const cues = track ? listTrackCues(db, track.id) : [];

  return {
    project: { ...project, canManage: access.canManage },
    run,
    preparations,
    derivatives: derivatives.map((derivative) => ({
      ...derivative,
      url: projectDerivativeUrl(
        project.id,
        derivative.kind,
        derivative.audioTrack,
      ),
    })),
    track,
    tracks,
    cues,
    transcriptionModels: transcriptionModelChoices(
      db,
      workerManifests,
      transcriptionDefaults.precision,
    ),
    detectedHardware: detectedWorkerHardware(workerManifests),
    transcriptionDefaults,
  };
};

export const actions: Actions = {
  transcribe: async ({ locals, params, request }) => {
    const user = requireUserOrLogin(locals);
    const values = await request.formData();
    return runFormAction(async () => {
      await enqueueTranscription(
        params.projectId,
        user.id,
        parseTranscriptionRequest(values),
      );
      redirect(303, projectPageUrl(params.projectId, params.trackId));
    }, "The transcription could not be queued.");
  },
  cancelTranscription: async ({ locals, params }) => {
    const user = requireUserOrLogin(locals);
    return runFormAction(async () => {
      if (!cancelTranscriptionForUser(params.projectId, user.id)) {
        return fail(409, {
          message: "The transcription is no longer active.",
        });
      }
      redirect(303, projectPageUrl(params.projectId, params.trackId));
    }, "The transcription could not be cancelled.");
  },
  prepareMedia: async ({ locals, params, request }) => {
    const user = requireUserOrLogin(locals);
    const audioTrack = audioTrackField(await request.formData());
    if (typeof audioTrack !== "number") return audioTrack;
    return runFormAction(async () => {
      requestMediaPreparationForUser(params.projectId, user.id, audioTrack);
      redirect(303, projectPageUrl(params.projectId, params.trackId));
    }, "Media preparation could not be queued.");
  },
  cancelMedia: async ({ locals, params, request }) => {
    const user = requireUserOrLogin(locals);
    const audioTrack = audioTrackField(await request.formData());
    if (typeof audioTrack !== "number") return audioTrack;
    return runFormAction(async () => {
      if (
        !(await cancelMediaPreparationForUser(
          params.projectId,
          user.id,
          audioTrack,
        ))
      ) {
        return fail(409, {
          message: "Media preparation is no longer active.",
        });
      }
      redirect(303, projectPageUrl(params.projectId, params.trackId));
    }, "Media preparation could not be cancelled.");
  },
  removeAudioCopy: async ({ locals, params, request }) => {
    const user = requireUserOrLogin(locals);
    const audioTrack = audioTrackField(await request.formData());
    if (typeof audioTrack !== "number") return audioTrack;
    return runFormAction(async () => {
      if (
        !(await removeAudioTrackCopyForUser(
          params.projectId,
          audioTrack,
          user.id,
        ))
      ) {
        return fail(404, { message: "That track's audio was not prepared." });
      }
      redirect(303, projectPageUrl(params.projectId, params.trackId));
    }, "The track's audio could not be removed.");
  },
  deleteTranscript: async ({ locals, params, request }) => {
    const user = requireUserOrLogin(locals);
    const trackId = String((await request.formData()).get("trackId") ?? "");
    if (!isUuid(trackId)) {
      return fail(400, { message: "The subtitle track is invalid." });
    }
    return runFormAction(async () => {
      if (!deleteTranscriptForUser(params.projectId, trackId, user.id)) {
        return fail(404, {
          message: "The transcript was not found or cannot be deleted.",
        });
      }
      redirect(303, projectPageUrl(params.projectId));
    }, "The transcript could not be deleted.");
  },
  deleteProject: async ({ locals, params }) => {
    const user = requireUserOrLogin(locals);
    return runFormAction(async () => {
      if (!(await deleteProjectForUser(params.projectId, user.id))) {
        return fail(404, {
          message: "The project was not found or cannot be deleted.",
        });
      }
      redirect(303, "/");
    }, "The project could not be deleted.");
  },
};

// The first track when the form names none.
function audioTrackField(
  values: FormData,
): number | ActionFailure<{ message: string }> {
  const value = String(values.get("audioTrack") ?? "0");
  return /^\d+$/.test(value)
    ? Number(value)
    : fail(400, { message: "Choose a valid audio track." });
}
