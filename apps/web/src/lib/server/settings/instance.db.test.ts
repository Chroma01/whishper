import { describe, expect, it } from "vitest";

import {
  parseTranscriptionDefaults,
  parseTranslationSettings,
  parseUploadLimit,
  readInstanceSettings,
  updateInstanceSettings,
} from "#lib/server/settings/instance.ts";
import {
  DEFAULT_INSTANCE_SETTINGS,
  GIB,
} from "#lib/shared/instance-settings.ts";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

const TRANSCRIPTION_FORM = {
  model: "whisperx:small",
  language: "es",
  alignment: "on",
  maxLineLength: "37",
  precision: "memory",
};

describe("instance settings", () => {
  it("start from the defaults", () => {
    expect(readInstanceSettings()).toEqual(DEFAULT_INSTANCE_SETTINGS);
  });

  it("keep the settings each change leaves alone", () => {
    updateInstanceSettings({ precision: "precise" });
    updateInstanceSettings({ maxUploadBytes: 5 * GIB, language: "de" });

    expect(readInstanceSettings()).toEqual({
      ...DEFAULT_INSTANCE_SETTINGS,
      precision: "precise",
      maxUploadBytes: 5 * GIB,
      language: "de",
    });
  });
});

describe("parseTranscriptionDefaults", () => {
  it("reads every field", () => {
    expect(parseTranscriptionDefaults(form(TRANSCRIPTION_FORM))).toEqual({
      value: {
        model: "whisperx:small",
        language: "es",
        alignment: true,
        maxLineLength: 37,
        precision: "memory",
      },
    });
  });

  it("turns the automatic choices into null and an unchecked box into false", () => {
    const parsed = parseTranscriptionDefaults(
      form({
        ...TRANSCRIPTION_FORM,
        model: "auto",
        language: "auto",
        alignment: "",
      }),
    );

    expect(parsed).toMatchObject({
      value: { model: null, language: null, alignment: false },
    });
  });

  it.each([
    ["model", "small"],
    ["language", "Spanish"],
    ["maxLineLength", "200"],
    ["maxLineLength", "4.5"],
    ["precision", "float16"],
  ])("names the invalid %s field", (field, value) => {
    const parsed = parseTranscriptionDefaults(
      form({ ...TRANSCRIPTION_FORM, [field]: value }),
    );

    expect(parsed).toMatchObject({ problem: { field } });
  });
});

describe("parseUploadLimit", () => {
  it("reads a preset or a custom size in GiB", () => {
    expect(parseUploadLimit(form({ uploadLimit: "25" }))).toEqual({
      value: 25 * GIB,
    });
    expect(
      parseUploadLimit(
        form({ uploadLimit: "custom", customUploadLimit: "1.5" }),
      ),
    ).toEqual({ value: 1.5 * GIB });
  });

  it.each([
    [{ uploadLimit: "0" }, "uploadLimit"],
    [{ uploadLimit: "custom", customUploadLimit: "" }, "customUploadLimit"],
    [
      { uploadLimit: "custom", customUploadLimit: "99999" },
      "customUploadLimit",
    ],
  ])("rejects %o", (values, field) => {
    expect(parseUploadLimit(form(values))).toMatchObject({
      problem: { field },
    });
  });
});

describe("parseTranslationSettings", () => {
  const providers = new Set(["provider-1"]);

  it("clears the model when no provider is chosen", () => {
    expect(
      parseTranslationSettings(form({ providerId: "", model: "x" }), providers),
    ).toEqual({
      value: { translationProviderId: null, translationModel: null },
    });
  });

  it("keeps a known provider's model ID", () => {
    expect(
      parseTranslationSettings(
        form({ providerId: "provider-1", model: " gpt-4.1-mini " }),
        providers,
      ),
    ).toEqual({
      value: {
        translationProviderId: "provider-1",
        translationModel: "gpt-4.1-mini",
      },
    });
  });

  it.each([
    [{ providerId: "gone", model: "gpt" }, "providerId"],
    [{ providerId: "provider-1", model: "" }, "model"],
    [{ providerId: "provider-1", model: "two words" }, "model"],
  ])("refuses %o", (values, field) => {
    expect(parseTranslationSettings(form(values), providers)).toMatchObject({
      problem: { field },
    });
  });
});
