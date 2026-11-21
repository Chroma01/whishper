import { requireAdminOrLogin } from "#lib/server/auth/session.ts";
import { clientFailure } from "#lib/server/http/errors.ts";
import { fetchModelList } from "#lib/server/transcription/provider-catalog.ts";
import { providerConnection } from "#lib/server/transcription/providers.ts";
import { isChatModel } from "#lib/shared/providers.ts";
import { isUuid } from "#lib/shared/uuid.ts";
import type { RequestHandler } from "./$types";

const NO_STORE = { "Cache-Control": "private, no-store" };

// The chat models a provider lists, for the translation settings. Null when
// the provider has no model list, so the ID has to be typed.
export const GET: RequestHandler = async ({ locals, url }) => {
  requireAdminOrLogin(locals);
  const providerId = url.searchParams.get("providerId") ?? "";
  const connection = isUuid(providerId) ? providerConnection(providerId) : null;
  if (!connection) {
    return Response.json(
      { message: "That provider no longer exists." },
      { status: 404, headers: NO_STORE },
    );
  }
  try {
    const listed = await fetchModelList(connection);
    const models = listed
      ?.filter((model) => isChatModel(model.remoteId, model.type))
      .map((model) => model.remoteId)
      .sort((left, right) => left.localeCompare(right));
    return Response.json({ models: models ?? null }, { headers: NO_STORE });
  } catch (cause) {
    const failure = clientFailure(cause);
    if (!failure) throw cause;
    return Response.json(
      { message: failure.message },
      { status: failure.status, headers: NO_STORE },
    );
  }
};
