import { chromium, Browser, BrowserContext, Page } from "playwright";
import path from "path";
import fs from "fs";

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async init(headless: boolean = true): Promise<BrowserContext> {
    this.browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    return this.context;
  }

  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.context = null;
    this.browser = null;
  }

  // Detects common anti-bot / CAPTCHA blockers
  async checkForAntiBotChallenge(page: Page): Promise<boolean> {
    const content = await page.content();
    const lower = content.toLowerCase();

    if (
      lower.includes("cf-turnstile") ||
      lower.includes("g-recaptcha") ||
      lower.includes("hcaptcha") ||
      lower.includes("verify you are human") ||
      lower.includes("access denied") ||
      lower.includes("datadome") ||
      lower.includes("please verify your identity")
    ) {
      return true;
    }

    const title = (await page.title()).toLowerCase();
    if (title.includes("access denied") || title.includes("security check") || title.includes("just a moment")) {
      return true;
    }

    return false;
  }

  async captureEvidenceScreenshot(page: Page, stepName: string, applicationId: string): Promise<string> {
    const dir = path.join(process.cwd(), "public", "screenshots", applicationId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filename = `${Date.now()}_${stepName}.png`;
    const fullPath = path.join(dir, filename);
    await page.screenshot({ path: fullPath, fullPage: false });
    return `/screenshots/${applicationId}/${filename}`;
  }
}
