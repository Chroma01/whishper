import {
  TRANSLATION_VERSION,
  type RemoteModelAccess,
  type WorkerManifest,
} from "@anysub/contracts";
import { eq } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import { transcriptionProviders } from "#lib/server/db/schema.ts";
import { readInstanceSettings } from "#lib/server/settings/instance.ts";
import { describeModel, FIT_RANK } from "#lib/server/transcription/models.ts";
import { hostOf } from "#lib/server/transcription/providers.ts";
import type { Precision } from "#lib/shared/instance-settings.ts";
import { detectProviderBrand } from "#lib/shared/provider-brands.ts";
import { PROVIDER_TRANSLATION } from "#lib/shared/translation.ts";
import {
  REMOTE_ADAPTER_ID,
  type ModelChoice,
} from "#lib/shared/transcription-models.ts";

export type TranslationModel = ModelChoice & {
  adapterId: string;
  // The provider's own model ID for the remote adapter.
  modelId: string;
  providerId: string | null;
};

export function supportsTranslation(manifest: WorkerManifest): boolean {
  return manifest.capabilities.translation === TRANSLATION_VERSION;
}

// The provider's model comes first: it translates more naturally, so it is
// the default whenever an administrator set one up. A local model is offered
// once a worker has downloaded it.
export function translationModels(
  executor: Executor,
  manifests: WorkerManifest[],
): TranslationModel[] {
  const workers = manifests.filter(supportsTranslation);
  if (workers.length === 0) return [];
  const provider = providerTranslationModel(executor);
  const { precision } = readInstanceSettings(executor);
  return [
    ...(provider ? [provider] : []),
    ...localTranslationModels(workers, precision),
  ];
}

export function toChoice(model: ModelChoice): ModelChoice {
  return {
    key: model.key,
    displayName: model.displayName,
    description: model.description,
    downloaded: model.downloaded,
    downloadSizeBytes: model.downloadSizeBytes,
    recommended: model.recommended,
    memoryRequirementBytes: model.memoryRequirementBytes,
    memoryRequirementKind: model.memoryRequirementKind,
    fit: model.fit,
    fitLabel: model.fitLabel,
    fitReason: model.fitReason,
    remote: model.remote,
  };
}

function providerTranslationModel(executor: Executor): TranslationModel | null {
  const { translationProviderId, translationModel } =
    readInstanceSettings(executor);
  if (!translationProviderId || !translationModel) return null;
  const provider = executor
    .select({
      name: transcriptionProviders.name,
      baseUrl: transcriptionProviders.baseUrl,
    })
    .from(transcriptionProviders)
    .where(eq(transcriptionProviders.id, translationProviderId))
    .get();
  if (!provider) return null;
  const host = hostOf(provider.baseUrl);
  return {
    key: PROVIDER_TRANSLATION,
    displayName: translationModel,
    description: `The transcript's text is sent to ${host}.`,
    downloaded: null,
    downloadSizeBytes: null,
    recommended: false,
    memoryRequirementBytes: null,
    memoryRequirementKind: null,
    fit: "good",
    fitLabel: provider.name,
    fitReason: `Sends the transcript's text to ${provider.name} at ${host}.`,
    remote: {
      providerName: provider.name,
      brand: detectProviderBrand(provider.name, provider.baseUrl),
      host,
    },
    adapterId: REMOTE_ADAPTER_ID,
    modelId: translationModel,
    providerId: translationProviderId,
  };
}

// Several workers can hold the same model: the one it fits best describes it.
function localTranslationModels(
  manifests: WorkerManifest[],
  precision: Precision,
): TranslationModel[] {
  const models = new Map<string, TranslationModel>();
  for (const manifest of manifests) {
    for (const adapter of manifest.adapters) {
      for (const model of adapter.models) {
        if (
          !model.capabilities.includes("translate") ||
          model.downloaded !== true
        ) {
          continue;
        }
        const described = describeModel(
          adapter,
          model,
          manifest.hardware,
          precision,
        );
        const current = models.get(described.key);
        if (current && FIT_RANK[current.fit] >= FIT_RANK[described.fit]) {
          continue;
        }
        models.set(described.key, {
          ...toChoice(described),
          adapterId: adapter.id,
          modelId: model.id,
          providerId: null,
        });
      }
    }
  }
  return [...models.values()];
}

// Read when a worker leases the job, so the key is never stored in it.
export function translationModelAccess(
  executor: Executor,
  providerId: string,
  model: string,
): RemoteModelAccess | null {
  const provider = executor
    .select({
      providerName: transcriptionProviders.name,
      baseUrl: transcriptionProviders.baseUrl,
      apiKey: transcriptionProviders.apiKey,
    })
    .from(transcriptionProviders)
    .where(eq(transcriptionProviders.id, providerId))
    .get();
  return provider ? { ...provider, model } : null;
}
