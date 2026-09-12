import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function main() {
  const userDataDir = path.resolve(process.cwd(), 'data', 'browser-profile');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  console.log('======================================================');
  console.log('🔑 OPENING INDEED LOGIN (PERSISTENT BROWSER PROFILE)');
  console.log('======================================================');
  console.log(`📁 Profile directory: ${userDataDir}`);
  console.log('🌐 Navigating to Indeed authentication page in a visible window...\n');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 850 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  
  try {
    await page.goto('https://secure.indeed.com/auth', { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    await page.goto('https://www.indeed.com/', { waitUntil: 'domcontentloaded' });
  }

  console.log('✅ Browser launched! Please log in to your Indeed account in the window.');
  console.log('💾 Your login cookies and session will be automatically saved to data/browser-profile/ for all future runs.');
  console.log('⏳ This window will stay open for your session. Close the browser window when you are finished logging in.\n');

  // Keep process open until context closes
  await new Promise<void>((resolve) => {
    context.on('close', () => {
      console.log('🔒 Browser closed. Session profile preserved in data/browser-profile/.');
      resolve();
    });
  });
}

main().catch((err) => {
  console.error('Error opening Indeed browser:', err);
  process.exit(1);
});
