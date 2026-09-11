/**
 * Browser resolution for the check suites.
 *
 * `playwright-core` deliberately downloads nothing, so it needs to be pointed at
 * a browser that is already installed. This resolves one without hardcoding a
 * path, in order of preference:
 *
 *   1. $CHROME_PATH, if set — the escape hatch for any layout not covered below
 *   2. the usual install locations for Chrome/Chromium on common distros
 *   3. Playwright's `channel: 'chrome'`, which does its own system lookup
 *
 * Runs headless by default so the suites need no display server. Set HEADED=1
 * to watch a run (requires a working X/Wayland display, however your machine
 * provides one).
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findBrowser() {
  const hit = CANDIDATES.find((p) => existsSync(p));
  return hit ?? null;
}

export async function launchBrowser() {
  const headless = process.env.HEADED !== '1';
  const args = ['--no-first-run', '--no-default-browser-check'];

  const executablePath = findBrowser();
  if (executablePath) {
    return chromium.launch({ executablePath, headless, args });
  }

  // Nothing at a known path — let Playwright try to locate an installed Chrome.
  try {
    return await chromium.launch({ channel: 'chrome', headless, args });
  } catch (cause) {
    throw new Error(
      'No Chrome/Chromium found. Install one, or point CHROME_PATH at it:\n' +
        '  CHROME_PATH=/path/to/chrome node scripts/check-fixture.mjs\n' +
        `Looked in:\n${CANDIDATES.map((p) => `  ${p}`).join('\n')}`,
      { cause },
    );
  }
}
