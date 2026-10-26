export type ScreenshotReviewInput = {
  screenshotPath: string;
  route: string;
  viewport: string;
  acceptanceCriteria: string[];
};

export type ScreenshotReviewOutput = {
  passed: boolean;
  issues: string[];
  polishScore: number;
  recommendedFixes: string[];
};

export async function reviewScreenshot(
  input: ScreenshotReviewInput
): Promise<ScreenshotReviewOutput> {
  // TODO: Connect this interface to OpenAI or Claude multimodal inspection.
  // The runner stores screenshots and metadata now so a model can inspect them later.
  return {
    passed: true,
    issues: [],
    polishScore: input.acceptanceCriteria.length > 0 ? 0.75 : 0.6,
    recommendedFixes: []
  };
}
