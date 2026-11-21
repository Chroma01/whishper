import { describe, expect, it } from "vitest";

import { classifyRemoteModel, isChatModel } from "#lib/shared/providers.ts";

describe("classifyRemoteModel", () => {
  it.each([
    ["whisper-large-v3-turbo", "audio", "speech"],
    ["voxtral-small-24b", "audio", "text-only"],
    ["voxtral-mini-4b-realtime", "audio", "text-only"],
    ["qwen3-tts", "tts", "other"],
    ["gpt-oss-120b", "chat", "other"],
    ["whisper-tiny", "embedding", "other"],
  ])("uses the type the provider gives: %s (%s)", (remoteId, type, kind) => {
    expect(classifyRemoteModel(remoteId, type)).toBe(kind);
  });

  it.each([
    ["whisper-1", "speech"],
    ["voxtral-mini-latest", "text-only"],
    ["gpt-4o-transcribe", "text-only"],
    ["gpt-4o-mini-transcribe-2025-12-15", "text-only"],
    ["tts-1", "other"],
    ["gpt-4.1", "other"],
  ])("guesses from the name without a type: %s", (remoteId, kind) => {
    expect(classifyRemoteModel(remoteId)).toBe(kind);
  });
});

describe("isChatModel", () => {
  it.each([
    ["gpt-4.1-mini", null, true],
    ["meta-llama/llama-3.3-70b-instruct", null, true],
    ["deepseek-r1-0528", "chat", true],
    ["whisper-large-v3", null, false],
    ["gpt-4o-mini-transcribe", null, false],
    ["voxtral-small-24b", null, false],
    ["text-embedding-3-small", null, false],
    ["tts-1", null, false],
    ["llama-guard-4-12b", null, false],
    ["gemma-3", "audio", false],
  ])("%s with type %s is a chat model: %s", (remoteId, type, expected) => {
    expect(isChatModel(remoteId, type)).toBe(expected);
  });
});
