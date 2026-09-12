import { BrowserContext, Page } from 'playwright';

export interface LoginResult {
  loggedIn: boolean;
  method: 'cached' | 'auto-login' | 'manual-2fa' | 'skipped';
}

/**
 * Ensures the browser context has an active Indeed login session.
 * Checks if already logged in. If not, performs auto-login with env credentials.
 * If 2FA is detected, pauses for manual intervention (non-headless mode).
 */
export async function ensureIndeedLogin(context: BrowserContext): Promise<LoginResult> {
  const email = process.env.INDEED_EMAIL;
  const password = process.env.INDEED_PASSWORD;

  if (!email || !password) {
    console.log('[IndeedAuth] No INDEED_EMAIL / INDEED_PASSWORD in environment — skipping auto-login.');
    return { loggedIn: false, method: 'skipped' };
  }

  let page: Page | null = null;
  try {
    page = await context.newPage();
    console.log('[IndeedAuth] Checking current Indeed session status...');
    await page.goto('https://www.indeed.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Check if already logged in — look for account menu / profile icon
    const accountMenu = await page.$(
      '[data-gnav-element-name="AccountMenu"], [data-testid="gnav-AccountMenu"], a[href*="/account"], .gnav-Account, button[aria-label*="Account"], [data-testid="AccountMenu"]'
    );
    if (accountMenu) {
      console.log('[IndeedAuth] Already logged in (cached session active).');
      await page.close();
      return { loggedIn: true, method: 'cached' };
    }

    // Navigate to login page
    console.log('[IndeedAuth] Not logged in. Attempting auto-login with configured credentials...');
    await page.goto('https://secure.indeed.com/auth', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    // Fill email
    const emailInput = await page.$('input[type="email"], input[name="__email"], #ifl-InputFormField-3, input[name="email"]');
    if (emailInput) {
      await emailInput.fill(email);
      const continueBtn = await page.$(
        'button[type="submit"], button:has-text("Continue"), button:has-text("Sign in"), button:has-text("Next")'
      );
      if (continueBtn) {
        await continueBtn.click();
        await page.waitForTimeout(3000);
      }
    }

    // Fill password if password field appears
    const passwordInput = await page.$('input[type="password"], input[name="__password"], input[name="password"]');
    if (passwordInput) {
      await passwordInput.fill(password);
      const signInBtn = await page.$(
        'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Submit")'
      );
      if (signInBtn) {
        await signInBtn.click();
        await page.waitForTimeout(4000);
      }
    }

    // Check for 2FA / verification challenge
    const bodyText = (await page.textContent('body') || '').toLowerCase();
    if (
      bodyText.includes('verification') ||
      bodyText.includes('two-factor') ||
      bodyText.includes('enter the code') ||
      bodyText.includes('verify your identity') ||
      bodyText.includes('security code')
    ) {
      console.log('[IndeedAuth] 2FA / verification challenge detected.');
      console.log('[IndeedAuth] Waiting up to 120 seconds for manual 2FA completion in browser...');

      try {
        await page.waitForURL((url) => !url.toString().includes('/auth') && url.toString().includes('indeed.com'), {
          timeout: 120000,
        });
        await page.waitForTimeout(3000);
        const postAuthMenu = await page.$(
          '[data-gnav-element-name="AccountMenu"], [data-testid="gnav-AccountMenu"], a[href*="/account"]'
        );
        if (postAuthMenu) {
          console.log('[IndeedAuth] Login successful after manual 2FA.');
          await page.close();
          return { loggedIn: true, method: 'manual-2fa' };
        }
      } catch {
        console.warn('[IndeedAuth] 2FA timeout — continuing with current session.');
      }
    }

    // Final verification — navigate to home and check session
    await page.goto('https://www.indeed.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    const finalCheck = await page.$(
      '[data-gnav-element-name="AccountMenu"], [data-testid="gnav-AccountMenu"], a[href*="/account"], .gnav-Account'
    );

    if (finalCheck) {
      console.log('[IndeedAuth] Auto-login successfully verified.');
      await page.close();
      return { loggedIn: true, method: 'auto-login' };
    }

    console.warn('[IndeedAuth] Auto-login attempt finished. Session could not be definitively verified, but profile cookies are stored.');
    await page.close();
    return { loggedIn: false, method: 'auto-login' };
  } catch (err) {
    console.error('[IndeedAuth] Error during Indeed authentication:', err);
    if (page) await page.close().catch(() => {});
    return { loggedIn: false, method: 'auto-login' };
  }
}
