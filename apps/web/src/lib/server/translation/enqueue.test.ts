import { describe, expect, it } from "vitest";

import { parseTranslationRequest } from "#lib/server/translation/enqueue.ts";

const TRACK = "0d9c4b9e-3f55-4c1e-9c51-7f1f0d0f8a11";

function form(fields: [string, string][]): FormData {
  const values = new FormData();
  for (const [name, value] of fields) values.append(name, value);
  return values;
}

describe("parseTranslationRequest", () => {
  it("reads the transcript, model and each language once", () => {
    expect(
      parseTranslationRequest(
        form([
          ["sourceTrackId", TRACK],
          ["model", "provider"],
          ["targetLanguage", "es"],
          ["targetLanguage", "pt-BR"],
          ["targetLanguage", "es"],
        ]),
      ),
    ).toEqual({
      sourceTrackId: TRACK,
      modelKey: "provider",
      targetLanguages: ["es", "pt-BR"],
    });
  });

  it("refuses a missing language, too many, or one not on the list", () => {
    const base: [string, string][] = [
      ["sourceTrackId", TRACK],
      ["model", "provider"],
    ];
    expect(() => parseTranslationRequest(form(base))).toThrow(/at least one/);
    expect(() =>
      parseTranslationRequest(form([...base, ["targetLanguage", "<script>"]])),
    ).toThrow(/from the list/);
    const eleven = "ab ac ad ae af ag ah ai aj ak al"
      .split(" ")
      .map((code): [string, string] => ["targetLanguage", code]);
    expect(() => parseTranslationRequest(form([...base, ...eleven]))).toThrow(
      /at most 10/,
    );
    expect(() =>
      parseTranslationRequest(
        form([
          ["model", "x"],
          ["targetLanguage", "es"],
        ]),
      ),
    ).toThrow(/transcript/);
  });
});
