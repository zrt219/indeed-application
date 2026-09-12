import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export interface BrowserManagerOptions {
  headless?: boolean;
  slowMo?: number;
  userDataDir?: string;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private isHeadless: boolean;

  constructor(options?: BrowserManagerOptions) {
    this.isHeadless = options?.headless ?? (process.env.HEADLESS !== 'false');
  }

  async launch(): Promise<BrowserContext> {
    if (this.context) return this.context;

    this.browser = await chromium.launch({
      headless: this.isHeadless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/Chicago',
    });

    return this.context;
  }

  async newPage(): Promise<Page> {
    const context = await this.launch();
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    return page;
  }

  async captureScreenshot(page: Page, filename: string): Promise<string> {
    const dir = path.resolve(process.cwd(), 'screenshots');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const targetPath = path.join(dir, filename);
    await page.screenshot({ path: targetPath, fullPage: true });
    return targetPath;
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
