import { describe, expect, it } from "vitest";

import {
  formatEditorTime,
  parseEditorTime,
  renderLrc,
  renderPlainText,
  renderSrt,
  renderWebVtt,
} from "#lib/shared/subtitles.ts";

const cues = [
  {
    id: "b14d765a-0cb2-4fa8-af80-c563ab57c959",
    position: 0,
    startUs: 3_723_456_789,
    endUs: 3_725_000_000,
    text: "A subtitle.",
  },
];

describe("subtitle timecodes", () => {
  it("round-trips editor timecodes", () => {
    expect(formatEditorTime(3_723_456_789)).toBe("01:02:03.456");
    expect(formatEditorTime(-1)).toBe("00:00:00.000");
    expect(parseEditorTime("01:02:03.456")).toBe(3_723_456_000);
    expect(parseEditorTime("02:03,5")).toBe(123_500_000);
    expect(parseEditorTime("00:61.000")).toBeNull();
  });

  it("parses loose pasted forms", () => {
    expect(parseEditorTime("1:02.5")).toBe(62_500_000);
    expect(parseEditorTime("62.5")).toBe(62_500_000);
    expect(parseEditorTime("00:01:02,500")).toBe(62_500_000);
    expect(parseEditorTime("1:02:03")).toBe(3_723_000_000);
    expect(parseEditorTime("27")).toBe(27_000_000);
    expect(parseEditorTime(" 01:02:03.456\n")).toBe(3_723_456_000);
    expect(parseEditorTime("100:00:00.000")).toBe(360_000_000_000);
  });

  it("rejects malformed and out of range times", () => {
    for (const value of [
      "",
      "abc",
      "-5",
      "1.2345",
      "5.",
      ".5",
      "1:5",
      "1:60",
      "1:61:00",
      "1:2:3:4",
      "1.2.3",
      "01:02:03.456 extra",
    ]) {
      expect(parseEditorTime(value), value).toBeNull();
    }
  });
});

describe("subtitle exports", () => {
  it("renders SRT with comma millisecond separators", () => {
    expect(renderSrt(cues)).toBe(
      "1\n01:02:03,456 --> 01:02:05,000\nA subtitle.\n",
    );
  });

  it("renders WebVTT with a header and period separators", () => {
    expect(renderWebVtt(cues)).toBe(
      "WEBVTT\n\n01:02:03.456 --> 01:02:05.000\nA subtitle.\n",
    );
  });

  it("collapses blank lines inside a cue so it cannot split into two", () => {
    const blankLines = [{ ...cues[0], text: "First\n\n \r\nSecond" }];

    expect(renderSrt(blankLines)).toBe(
      "1\n01:02:03,456 --> 01:02:05,000\nFirst\nSecond\n",
    );
    expect(renderWebVtt(blankLines)).toBe(
      "WEBVTT\n\n01:02:03.456 --> 01:02:05.000\nFirst\nSecond\n",
    );
  });

  it("escapes the WebVTT cue timing arrow in cue text", () => {
    const injected = [{ ...cues[0], text: "a --> b\n00:00.000 --> 00:01.000" }];

    expect(renderWebVtt(injected)).toBe(
      "WEBVTT\n\n01:02:03.456 --> 01:02:05.000\na --&gt; b\n00:00.000 --&gt; 00:01.000\n",
    );
  });

  it("escapes markup characters in WebVTT cue text", () => {
    const markup = [{ ...cues[0], text: "Fish & <i>chips</i>" }];

    expect(renderWebVtt(markup)).toBe(
      "WEBVTT\n\n01:02:03.456 --> 01:02:05.000\nFish &amp; &lt;i&gt;chips&lt;/i&gt;\n",
    );
  });

  it("neutralizes the timing arrow in SRT cue text", () => {
    const injected = [{ ...cues[0], text: "a --> b" }];

    expect(renderSrt(injected)).toBe(
      "1\n01:02:03,456 --> 01:02:05,000\na -> b\n",
    );
  });

  it("renders plain text with one line per cue and no timecodes", () => {
    const transcript = [
      { ...cues[0], text: "First line\nwraps here." },
      { ...cues[0], position: 1, text: " \n " },
      { ...cues[0], position: 2, text: "Second cue." },
    ];

    expect(renderPlainText(transcript)).toBe(
      "First line wraps here.\nSecond cue.\n",
    );
    expect(renderPlainText([])).toBe("");
  });

  it("renders LRC with one line per cue and minutes past the hour", () => {
    expect(renderLrc(cues)).toBe("[62:03.45]A subtitle.\n[62:05.00]\n");
  });

  it("clears an LRC line only when a pause of five seconds or more follows", () => {
    const lyrics = [
      { ...cues[0], startUs: 1_000_000, endUs: 2_500_000, text: "First\nline" },
      {
        ...cues[0],
        position: 1,
        startUs: 6_000_000,
        endUs: 7_000_000,
        text: "After a breath",
      },
      {
        ...cues[0],
        position: 2,
        startUs: 12_000_000,
        endUs: 13_000_000,
        text: "After a break",
      },
    ];

    expect(renderLrc(lyrics)).toBe(
      "[00:01.00]First line\n[00:06.00]After a breath\n[00:07.00]\n[00:12.00]After a break\n[00:13.00]\n",
    );
  });

  it("orders LRC lines by time and leaves out blank cues", () => {
    const unordered = [
      { ...cues[0], startUs: 9_000_000, endUs: 9_500_000, text: "Later" },
      {
        ...cues[0],
        position: 1,
        startUs: 1_000_000,
        endUs: 2_000_000,
        text: " \n ",
      },
      {
        ...cues[0],
        position: 2,
        startUs: 8_000_000,
        endUs: 8_600_000,
        text: "Sooner",
      },
    ];

    expect(renderLrc(unordered)).toBe(
      "[00:08.00]Sooner\n[00:09.00]Later\n[00:09.50]\n",
    );
    expect(renderLrc([])).toBe("");
  });
});
