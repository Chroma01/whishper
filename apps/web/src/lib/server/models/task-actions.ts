import type { ModelCacheAction } from "@anysub/contracts";
import type { RequestEvent } from "@sveltejs/kit";

import { requireAdminOrLogin } from "#lib/server/auth/session.ts";
import { runFormAction } from "#lib/server/http/actions.ts";
import { badRequest, conflict } from "#lib/server/http/errors.ts";
import {
  cancelModelTask,
  requestModelTask,
  type ModelTaskRequest,
} from "#lib/server/models/tasks.ts";
import { isUuid } from "#lib/shared/uuid.ts";

function modelTask(form: FormData, action: ModelCacheAction): ModelTaskRequest {
  const workerId = String(form.get("workerId") ?? "");
  const adapterId = String(form.get("adapterId") ?? "");
  const modelId = String(form.get("modelId") ?? "");
  if (!isUuid(workerId) || !adapterId || !modelId) {
    throw badRequest("Choose a model from the list.");
  }
  return { workerId, adapterId, modelId, action };
}

// The download, removal and cancel buttons of a model row, for every page
// that shows one.
export const modelTaskActions = {
  download: async ({ locals, request }: RequestEvent) => {
    requireAdminOrLogin(locals);
    const form = await request.formData();
    return runFormAction(() => requestModelTask(modelTask(form, "download")));
  },
  remove: async ({ locals, request }: RequestEvent) => {
    requireAdminOrLogin(locals);
    const form = await request.formData();
    return runFormAction(() => requestModelTask(modelTask(form, "delete")));
  },
  cancel: async ({ locals, request }: RequestEvent) => {
    requireAdminOrLogin(locals);
    const jobId = String((await request.formData()).get("jobId") ?? "");
    return runFormAction(() => {
      if (!isUuid(jobId) || !cancelModelTask(jobId)) {
        throw conflict("That download or removal has already finished.");
      }
    });
  },
};
