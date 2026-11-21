import { fail } from "@sveltejs/kit";

import { requireAdminOrLogin } from "#lib/server/auth/session.ts";
import { db } from "#lib/server/db/index.ts";
import { modelInventoriesFor } from "#lib/server/models/inventory.ts";
import { modelTaskActions } from "#lib/server/models/task-actions.ts";
import {
  parseTranslationSettings,
  readInstanceSettings,
  updateInstanceSettings,
} from "#lib/server/settings/instance.ts";
import { adminProviders } from "#lib/server/transcription/providers.ts";
import { supportsTranslation } from "#lib/server/translation/models.ts";
import { activeWorkerManifests } from "#lib/server/workers/presence.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => {
  requireAdminOrLogin(locals);
  const { translationProviderId, translationModel } = readInstanceSettings(db);
  return {
    providers: adminProviders(db).map(({ id, name, brand, host }) => ({
      id,
      name,
      brand,
      host,
    })),
    providerId: translationProviderId,
    model: translationModel,
    workers: modelInventoriesFor(db, "translation"),
    workerConnected: activeWorkerManifests(db).some(supportsTranslation),
  };
};

export const actions: Actions = {
  ...modelTaskActions,
  save: async ({ locals, request }) => {
    requireAdminOrLogin(locals);
    const providerIds = new Set(adminProviders(db).map(({ id }) => id));
    const parsed = parseTranslationSettings(
      await request.formData(),
      providerIds,
    );
    if ("problem" in parsed) return fail(400, { problem: parsed.problem });
    updateInstanceSettings(parsed.value);
    return { saved: true };
  },
};
