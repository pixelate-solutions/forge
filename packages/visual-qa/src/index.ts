import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { VIEWPORTS, type ViewportConfig, type VisualQAResult } from "@forge/core";

export type RunVisualQAInput = {
  baseUrl: string;
  routes: string[];
  viewports?: ViewportConfig[];
  runId: string;
  outputDir: string;
};

export type RunVisualQAOutput = {
  passed: boolean;
  results: VisualQAResult[];
  reportPath: string;
};

export async function runVisualQA(input: RunVisualQAInput): Promise<RunVisualQAOutput> {
  const viewports = input.viewports ?? VIEWPORTS;
  const screenshotDir = path.join(input.outputDir, "runs", input.runId, "screenshots");
  const reportDir = path.join(input.outputDir, "runs", input.runId, "reports");
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });

  const browser = await chromium.launch();
  const results: VisualQAResult[] = [];
  try {
    for (const route of input.routes) {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
        const consoleErrors: string[] = [];
        const networkErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("requestfailed", (request) => {
          if (request.url().includes("_rsc=") && request.failure()?.errorText === "net::ERR_ABORTED") return;
          networkErrors.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
        });

        const url = new URL(route, input.baseUrl).toString();
        const screenshotPath = path.join(screenshotDir, `${safeName(route)}-${viewport.name}.png`);
        const notes: string[] = [];
        let hasHorizontalOverflow = false;
        let brokenImages: string[] = [];
        let missingAltImages: string[] = [];

        try {
          await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
          await page.waitForTimeout(350);
          hasHorizontalOverflow = await page.evaluate(() => {
            return document.documentElement.scrollWidth > document.documentElement.clientWidth;
          });
          brokenImages = await page.evaluate(() => {
            return Array.from(document.images)
              .filter((img) => !img.complete || img.naturalWidth === 0)
              .map((img) => img.currentSrc || img.src);
          });
          missingAltImages = await page.evaluate(() => {
            return Array.from(document.images)
              .filter((img) => !img.hasAttribute("alt"))
              .map((img) => img.currentSrc || img.src);
          });
          await checkInteractiveControls(page, notes);
        } catch (error) {
          notes.push(error instanceof Error ? error.message : String(error));
        } finally {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          await page.close();
        }

        results.push({
          runId: input.runId,
          route,
          viewport: viewport.name,
          screenshotPath,
          consoleErrors,
          networkErrors,
          hasHorizontalOverflow,
          brokenImages,
          missingAltImages,
          notes,
          passed:
            consoleErrors.length === 0 &&
            networkErrors.length === 0 &&
            !hasHorizontalOverflow &&
            brokenImages.length === 0 &&
            notes.length === 0
        });
      }
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(reportDir, "visual-qa-report.json");
  writeFileSync(reportPath, JSON.stringify({ runId: input.runId, generatedAt: new Date().toISOString(), results }, null, 2));
  return { passed: results.every((result) => result.passed), results, reportPath };
}

async function checkInteractiveControls(page: Page, notes: string[]): Promise<void> {
  const unusableButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, a, input, select, textarea"))
      .filter((element) => {
        if (element instanceof HTMLInputElement && ["checkbox", "radio", "file", "hidden"].includes(element.type)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const intentionallyHidden =
          rect.width === 0 ||
          rect.height === 0 ||
          style.visibility === "hidden" ||
          style.display === "none";
        return !intentionallyHidden && (rect.width < 20 || rect.height < 20);
      })
      .slice(0, 10)
      .map((element) => element.outerHTML.slice(0, 180));
  });
  if (unusableButtons.length > 0) {
    notes.push(`Found hidden or zero-size interactive controls: ${unusableButtons.join(" | ")}`);
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
}
