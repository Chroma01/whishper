import { db } from "#lib/server/db/index.ts";
import { requireUser } from "#lib/server/auth/session.ts";
import {
  listLibraryStatuses,
  primaryWorkspaceForUser,
} from "#lib/server/projects/library.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireUser(locals);
  const workspace = primaryWorkspaceForUser(db, user.id);
  return Response.json(workspace ? listLibraryStatuses(db, workspace.id) : [], {
    headers: { "Cache-Control": "private, no-store" },
  });
};
