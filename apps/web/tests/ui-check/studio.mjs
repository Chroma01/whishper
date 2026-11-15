import { checkPickers } from "./pickers.mjs";
import { checkTimecodeField } from "./timecode.mjs";
import {
  animationsFinished,
  axeViolations,
  focusedText,
  isFocused,
  openMenuWithKeyboard,
  outputDir,
  reportViolations,
  scrollsHorizontally,
  studioPath,
  widths,
} from "./shared.mjs";

const LONG_CUE_TEXT =
  "A very long cue line that keeps going without a break so the row has to wrap ".repeat(
    6,
  );

async function separatorValue(separator) {
  return Number(await separator.getAttribute("aria-valuenow"));
}

async function checkPaneSeparator(page) {
  const separator = page.getByRole("separator", {
    name: "Resize transcript pane",
  });
  await separator.focus();
  const before = await separatorValue(separator);
  await page.keyboard.press("ArrowLeft");
  const widened = await separatorValue(separator);
  await page.keyboard.press("ArrowRight");
  const max = Number(await separator.getAttribute("aria-valuemax"));
  if (widened <= before && before < max) {
    throw new Error("ArrowLeft on the pane separator did not widen the pane");
  }
}

async function newTranscriptUnavailableReason(page) {
  if (await page.getByText("No source media is attached").count()) {
    return "the project has no source media";
  }
  const running = page.getByRole("progressbar", {
    name: /^New .*transcript progress$/,
  });
  return (await running.count()) ? "a transcription is running" : null;
}

async function checkNewTranscriptDialog(page, theme) {
  const trigger = page.getByRole("button", {
    name: "New transcript",
    exact: true,
  });
  if (!(await trigger.count())) {
    const reason = await newTranscriptUnavailableReason(page);
    if (!reason) {
      throw new Error(
        "New transcript is missing on a studio with a transcript, source media and no active run",
      );
    }
    console.log(`SKIP new transcript dialog ${theme}: ${reason}`);
    return 0;
  }
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New transcript" });
  await dialog.waitFor();
  await animationsFinished(dialog);
  await page.screenshot({
    path: `${outputDir}/studio-new-transcript-${theme}-1440.png`,
  });
  let failures = reportViolations(
    await axeViolations(page, "dialog[open]"),
    { name: "studio-new-transcript" },
    theme,
    1440,
  );
  failures += await checkPickers(page, dialog, theme);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if (!(await isFocused(trigger))) {
    throw new Error(
      "closing the new transcript dialog did not refocus its trigger",
    );
  }
  return failures;
}

async function checkTranscriptMenu(page, theme) {
  const trigger = page
    .getByRole("region", { name: "Subtitle cues" })
    .getByRole("button", { name: /transcript$/ });
  await openMenuWithKeyboard(page, trigger);
  const menu = page.getByRole("menu", { name: "Transcripts" });
  const checked = menu.locator('[role="menuitemradio"][aria-checked="true"]');
  if ((await checked.count()) !== 1) {
    throw new Error("the transcript menu does not mark the open transcript");
  }
  if (!(await isFocused(checked))) {
    throw new Error("opening the transcript menu did not focus the open one");
  }
  await page.screenshot({
    path: `${outputDir}/studio-transcripts-${theme}-1440.png`,
  });
  const failures = reportViolations(
    await axeViolations(page, '[role="menu"]'),
    { name: "studio-transcripts" },
    theme,
    1440,
  );
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  if (!(await isFocused(trigger))) {
    throw new Error("Escape did not return focus to the transcript menu");
  }
  return failures;
}

async function checkExportMenu(page) {
  const trigger = page.getByRole("button", { name: "Export" });
  await openMenuWithKeyboard(page, trigger);
  if (!(await focusedText(page))?.startsWith("SRT")) {
    throw new Error("opening the export menu did not focus SRT");
  }
  await page.keyboard.press("Escape");
  await page.getByRole("menu", { name: "Export" }).waitFor({ state: "hidden" });
  if (!(await isFocused(trigger))) {
    throw new Error("Escape did not return focus to the export trigger");
  }
}

async function checkSpeedMenu(page) {
  const trigger = page.getByRole("button", { name: /^Playback speed/ });
  await openMenuWithKeyboard(page, trigger);
  if ((await focusedText(page)) !== "1×") {
    throw new Error("opening the speed menu did not focus the current speed");
  }
  await page.keyboard.press("Escape");
  await page
    .getByRole("menu", { name: "Playback speed" })
    .waitFor({ state: "hidden" });
  if (!(await isFocused(trigger))) {
    throw new Error("Escape did not return focus to the speed trigger");
  }
}

async function checkMediaDialog(page, theme) {
  const trigger = page.getByRole("button", { name: "Project actions" });
  await openMenuWithKeyboard(page, trigger);
  await page.getByRole("menuitem", { name: "Media details…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.screenshot({
    path: `${outputDir}/studio-media-${theme}-1440.png`,
  });
  const failures = reportViolations(
    await axeViolations(page, "dialog[open]"),
    { name: "studio-media" },
    theme,
    1440,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if (!(await isFocused(trigger))) {
    throw new Error("closing the media dialog did not return focus");
  }
  return failures;
}

export async function checkStudioKeyboard(context, theme) {
  const page = await context.newPage();
  const label = `studio keyboard ${theme}`;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const path = await studioPath(page, true);
    if (!path) {
      console.log(`SKIP ${label}: no project has a transcript`);
      return 0;
    }
    await checkPaneSeparator(page);
    let failures = await checkNewTranscriptDialog(page, theme);
    failures += await checkTranscriptMenu(page, theme);
    await checkExportMenu(page);
    await checkSpeedMenu(page);
    failures += await checkMediaDialog(page, theme);
    console.log(
      `${label}: separator, new transcript dialog, pickers, transcript menu, export menu, speed menu and media dialog ok`,
    );
    return failures;
  } catch (error) {
    console.error(`${label}: ${error.message}`);
    return 1;
  } finally {
    await page.close();
  }
}

// Sets the value in the DOM only. No input event fires, so nothing is saved.
async function showLongCueText(page) {
  await page
    .getByRole("textbox", { name: "Cue 1 text" })
    .evaluate((textarea, text) => {
      textarea.value = text;
    }, LONG_CUE_TEXT);
}

async function checkToolbarArrows(page) {
  const toolbar = page.getByRole("toolbar", { name: "Cue editing" });
  const tabStops = toolbar.locator('button[tabindex="0"]');
  if ((await tabStops.count()) !== 1) {
    throw new Error(
      "the cue editing toolbar does not have exactly one tab stop",
    );
  }
  await tabStops.focus();
  const before = await focusedLabel(page);
  await page.keyboard.press("End");
  const after = await focusedLabel(page);
  await page.keyboard.press("Home");
  if (before === after || (await focusedLabel(page)) !== before) {
    throw new Error("Home and End do not move focus inside the toolbar");
  }
}

// Moves the selection only, which is never saved.
async function checkTimelineKeys(page) {
  const cues = page.locator('[data-cue-part="whole"]');
  const count = await cues.count();
  const tabStops = page.locator('[data-cue-id] button[tabindex="0"]');
  if ((await tabStops.count()) !== Math.min(count, 1)) {
    throw new Error("the timeline cues do not have exactly one tab stop");
  }
  if (count < 2) return;
  const isRovingStop = (node) =>
    node === document.activeElement && node.tabIndex === 0;
  await tabStops.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const second = await cues.nth(1).evaluate(isRovingStop);
  await page.keyboard.press("End");
  const last = await cues.nth(count - 1).evaluate(isRovingStop);
  if (!second || !last) {
    throw new Error("arrows, Home and End do not move the timeline tab stop");
  }
}

async function focusedLabel(page) {
  return page.evaluate(
    () =>
      document.activeElement?.getAttribute("aria-label") ??
      document.activeElement?.textContent?.trim(),
  );
}

async function checkShortcutGuide(page, theme) {
  const trigger = page.getByRole("button", { name: "Keyboard shortcuts" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await dialog.waitFor();
  await animationsFinished(dialog);
  await page.screenshot({
    path: `${outputDir}/studio-shortcuts-${theme}-${page.viewportSize().width}.png`,
  });
  const failures = reportViolations(
    await axeViolations(page, "dialog[open]"),
    { name: "studio-shortcuts" },
    theme,
    page.viewportSize().width,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if (!(await isFocused(trigger))) {
    throw new Error("closing the shortcut guide did not refocus its trigger");
  }
  return failures;
}

export async function checkStudioCues(context, theme) {
  const page = await context.newPage();
  const label = `studio cues ${theme}`;
  let failures = 0;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const path = await studioPath(page, true);
    if (!path) {
      console.log(`SKIP ${label}: no project has a transcript`);
      return 0;
    }
    await checkToolbarArrows(page);
    await checkTimelineKeys(page);
    failures += await checkTimecodeField(page, theme);
    await showLongCueText(page);
    for (const width of [widths[0], widths.at(-1)]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `${outputDir}/studio-long-cue-${theme}-${width}.png`,
        fullPage: true,
      });
      if (await scrollsHorizontally(page)) {
        failures += 1;
        console.error(`${label} ${width}: the page scrolls horizontally`);
      }
      failures += reportViolations(
        await axeViolations(page),
        { name: "studio" },
        theme,
        width,
      );
      failures += await checkShortcutGuide(page, theme);
    }
    console.log(
      `${label}: toolbar and timeline keys, timecode field, long cue text and shortcut guide ok`,
    );
  } catch (error) {
    console.error(`${label}: ${error.message}`);
    failures += 1;
  } finally {
    await page.close();
  }
  return failures;
}
