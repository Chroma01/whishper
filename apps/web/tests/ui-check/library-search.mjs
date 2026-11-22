import {
  axeViolations,
  isFocused,
  open,
  openMenuWithKeyboard,
  outputDir,
  reportViolations,
  studioPath,
} from "./shared.mjs";

// A word taken from a real cue, so the search has something to find in
// whatever data the check runs against.
async function transcriptWord(page) {
  const path = await studioPath(page, true);
  if (!path) return null;
  const texts = await page
    .getByRole("textbox", { name: /^Cue \d+ text$/ })
    .evaluateAll((fields) => fields.map((field) => field.value));
  const words = texts
    .join(" ")
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 5);
  return words[0] ?? null;
}

async function checkEnglishCode(page) {
  const languages = page
    .locator("main ul > li")
    .getByText(/^Transcripts in .*English/)
    .first();
  if (!(await languages.count())) return false;
  const codes = await languages
    .locator("..")
    .locator('span[aria-hidden="true"]')
    .textContent();
  if (!codes.trim().split(/\s+/).includes("en")) {
    throw new Error(`a project with an English transcript shows "${codes}"`);
  }
  return true;
}

export async function checkLibrarySearch(context, theme) {
  const page = await context.newPage();
  const label = `library search ${theme}`;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const word = await transcriptWord(page);
    if (!word) {
      console.log(`SKIP ${label}: no transcript has a long enough word`);
      return 0;
    }
    await open(page, "/");
    const codeChecked = await checkEnglishCode(page);
    const box = page.getByRole("searchbox", {
      name: "Search project names and transcripts",
    });
    await page.keyboard.press("/");
    if (!(await isFocused(box))) throw new Error("/ did not focus the search");

    await page.keyboard.type(word);
    await page.waitForURL(/[?&]q=/);
    const lines = page.getByRole("list", { name: /^Matching lines in / });
    await lines.first().waitFor();
    const link = lines.first().getByRole("link").first();
    if (!/[?&]cue=/.test((await link.getAttribute("href")) ?? "")) {
      throw new Error("a matching line does not link to its cue");
    }
    await page.screenshot({
      path: `${outputDir}/library-search-${theme}-1440.png`,
    });
    let failures = reportViolations(
      await axeViolations(page),
      { name: "library-search" },
      theme,
      1440,
    );

    const status = page.getByRole("button", { name: "Status" });
    await openMenuWithKeyboard(page, status);
    failures += reportViolations(
      await axeViolations(page, '[role="menu"]'),
      { name: "library-status-menu" },
      theme,
      1440,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "hidden" });
    if (!(await isFocused(status))) {
      throw new Error("Escape did not return focus to the status filter");
    }
    const codeNote = codeChecked ? ", language codes" : "";
    console.log(
      `${label}: slash key, transcript matches${codeNote}, filter menu ok`,
    );
    return failures;
  } catch (error) {
    console.error(`${label}: ${error.message}`);
    return 1;
  } finally {
    await page.close();
  }
}
