import { redirect } from "@sveltejs/kit";

import { requireAdminOrLogin } from "#lib/server/auth/session.ts";
import type { PageServerLoad } from "./$types";

// Local models moved into the Transcription and Translation pages.
export const load: PageServerLoad = ({ locals }) => {
  requireAdminOrLogin(locals);
  redirect(308, "/admin/transcription#local-models");
};
