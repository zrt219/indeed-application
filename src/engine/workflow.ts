import path from 'path';
import fs from 'fs';
import { prisma } from '../db/prisma';
import { BrowserManager } from './browser/browser';
import { IndeedAdapter } from './adapters/indeed';
import { GenericAdapter } from './adapters/generic';
import { SiteAdapter } from './adapters/adapter.interface';
import { loadDefaultProfile } from '../qualification/engine';
import { loadAnswerBank } from '../llm/ollama';
import { emitLifecycleEvent } from '../sync/outbox';
import { ensureIndeedLogin } from './browser/indeed-auth';

export type ApplicationState =
  | 'NEW'
  | 'ANALYZED'
  | 'QUEUED'
  | 'APPLYING'
  | 'OPEN_APPLICATION'
  | 'INSPECT_FORM'
  | 'ANSWER_FIELDS'
  | 'UPLOAD_FILES'
  | 'VALIDATE_FORM'
  | 'NEXT_STEP'
  | 'FINAL_VALIDATION'
  | 'SUBMIT'
  | 'CONFIRMATION_DETECTION'
  | 'SUBMITTED'
  | 'BLOCKED_REQUIRES_MANUAL_ACTION'
  | 'SUBMISSION_FAILED'
  | 'TIMEOUT';

export interface WorkflowExecutionResult {
  applicationId: string;
  finalState: ApplicationState;
  success: boolean;
  confirmationText?: string;
  error?: string;
  screenshotPath?: string;
}

export class ApplicationWorkflowEngine {
  private browserManager: BrowserManager;
  private adapters: SiteAdapter[];
  private isAuthenticated = false;

  constructor(browserManager?: BrowserManager) {
    this.browserManager = browserManager || new BrowserManager();
    this.adapters = [new IndeedAdapter(), new GenericAdapter()];
  }

  private getAdapter(url: string): SiteAdapter {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(url)) {
        return adapter;
      }
    }
    return new GenericAdapter();
  }

  private async logEvent(
    type: string,
    metadata: Record<string, unknown>,
    applicationId?: string,
    jobId?: string
  ): Promise<void> {
    try {
      await emitLifecycleEvent(type, 'PLAYWRIGHT_AUTONOMOUS', {
        jobId,
        applicationId,
        metadata,
      });
    } catch (e) {
      console.error('Failed to log event to ledger and outbox:', e);
    }
  }

  /**
   * Main entry point to execute an application through the state machine
   */
  async executeApplication(jobId: string): Promise<WorkflowExecutionResult> {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { applications: true },
    });

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // 1. Duplicate Prevention Check
    const existingSubmitted = job.applications.find(
      (app) => app.status === 'SUBMITTED' || app.status === 'APPLYING'
    );
    if (existingSubmitted && existingSubmitted.status === 'SUBMITTED') {
      await this.logEvent(
        'DUPLICATE_PREVENTED',
        { reason: 'Application already successfully submitted for this job', jobId },
        existingSubmitted.id,
        job.id
      );
      return {
        applicationId: existingSubmitted.id,
        finalState: 'SUBMITTED',
        success: false,
        error: 'Duplicate application prevented: job already submitted.',
      };
    }

    // 2. Create or retrieve active Application record
    let application = job.applications.find((app) => app.status === 'PENDING');
    if (!application) {
      application = await prisma.application.create({
        data: {
          jobId: job.id,
          status: 'APPLYING',
        },
      });
    } else {
      application = await prisma.application.update({
        where: { id: application.id },
        data: { status: 'APPLYING' },
      });
    }

    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'APPLYING' },
    });

    await this.logEvent(
      'STATE_CHANGE',
      { from: 'QUEUED', to: 'APPLYING', jobTitle: job.title, url: job.url },
      application.id,
      job.id
    );

    const adapter = this.getAdapter(job.url);
    const profile = loadDefaultProfile();
    const answerBank = loadAnswerBank();

    // Check resume file path
    const defaultResumePath = path.resolve(process.cwd(), 'resumes', 'Alex_Rivera_Resume.pdf');
    const resumeFilePath = fs.existsSync(defaultResumePath) ? defaultResumePath : undefined;

    let page;
    let screenshotPath: string | undefined;

    try {
      // Ensure Indeed login session is active if credentials are configured
      if (!this.isAuthenticated && process.env.INDEED_EMAIL) {
        const context = await this.browserManager.launch();
        const loginResult = await ensureIndeedLogin(context);
        console.log(`[Workflow] Indeed login status: ${loginResult.method} (loggedIn: ${loginResult.loggedIn})`);
        this.isAuthenticated = true;
      }

      page = await this.browserManager.newPage();

      // State: OPEN_APPLICATION
      await this.logEvent('STATE_CHANGE', { to: 'OPEN_APPLICATION', adapter: adapter.name }, application.id, job.id);
      const startResult = await adapter.startApplication(page, job.url);

      if (!startResult.success) {
        screenshotPath = await this.browserManager.captureScreenshot(page, `failed_start_${application.id}.png`).catch(() => undefined);
        await this.handleFailure(
          application.id,
          job.id,
          'SUBMISSION_FAILED',
          startResult.error || 'Failed to initialize application'
        );
        return {
          applicationId: application.id,
          finalState: 'SUBMISSION_FAILED',
          success: false,
          error: startResult.error,
          screenshotPath,
        };
      }

      // Application Loop across pages/steps (Max 10 steps to prevent infinite loop)
      let currentStep = 1;
      const maxSteps = 10;
      let applicationCompleted = false;

      while (currentStep <= maxSteps) {
        // State: INSPECT_FORM
        await this.logEvent('STATE_CHANGE', { to: 'INSPECT_FORM', step: currentStep }, application.id, job.id);

        // State: ANSWER_FIELDS & UPLOAD_FILES
        await this.logEvent('STATE_CHANGE', { to: 'ANSWER_FIELDS', step: currentStep }, application.id, job.id);
        const fillResult = await adapter.fillCurrentStep(page, {
          profile,
          answerBank,
          resumeFilePath,
        });

        await this.logEvent(
          'FIELDS_PROCESSED',
          { filledCount: fillResult.filledFields, unanswered: fillResult.unansweredFields },
          application.id,
          job.id
        );

        // If manual review is required
        if (fillResult.requiresManualReview && fillResult.unansweredFields.length > 0) {
          screenshotPath = await this.browserManager.captureScreenshot(
            page,
            `manual_review_${application.id}_step_${currentStep}.png`
          ).catch(() => undefined);

          // Save manual review items to database
          for (const item of fillResult.unansweredFields) {
            await prisma.manualReview.create({
              data: {
                applicationId: application.id,
                jobId: job.id,
                question: item.label,
                reason: `Field selector: ${item.selector}. Step: ${currentStep}`,
                status: 'PENDING',
              },
            });
          }

          await this.logEvent(
            'STATE_CHANGE',
            {
              to: 'BLOCKED_REQUIRES_MANUAL_ACTION',
              step: currentStep,
              unansweredCount: fillResult.unansweredFields.length,
              screenshot: screenshotPath,
            },
            application.id,
            job.id
          );

          await prisma.application.update({
            where: { id: application.id },
            data: { status: 'REQUIRES_MANUAL_ACTION' },
          });

          await prisma.job.update({
            where: { id: job.id },
            data: { status: 'BLOCKED_REQUIRES_MANUAL_ACTION' },
          });

          return {
            applicationId: application.id,
            finalState: 'BLOCKED_REQUIRES_MANUAL_ACTION',
            success: false,
            error: fillResult.manualReviewReason,
            screenshotPath,
          };
        }

        // State: VALIDATE_FORM & NEXT_STEP
        await this.logEvent('STATE_CHANGE', { to: 'VALIDATE_FORM', step: currentStep }, application.id, job.id);
        const advanceResult = await adapter.advanceStep(page);

        if (advanceResult.hasErrors) {
          screenshotPath = await this.browserManager.captureScreenshot(
            page,
            `validation_error_${application.id}_step_${currentStep}.png`
          ).catch(() => undefined);

          await this.handleFailure(
            application.id,
            job.id,
            'SUBMISSION_FAILED',
            `Step validation failed: ${advanceResult.errorMessage}`
          );

          return {
            applicationId: application.id,
            finalState: 'SUBMISSION_FAILED',
            success: false,
            error: advanceResult.errorMessage,
            screenshotPath,
          };
        }

        if (advanceResult.isComplete) {
          // Submitted!
          applicationCompleted = true;
          break;
        }

        if (!advanceResult.movedNext) {
          // If neither completed nor moved, check if we hit confirmation
          const confCheck = await adapter.checkConfirmation(page);
          if (confCheck.isConfirmed) {
            applicationCompleted = true;
            break;
          }
          // Stuck on form
          break;
        }

        currentStep++;
      }

      // State: CONFIRMATION_DETECTION
      await this.logEvent('STATE_CHANGE', { to: 'CONFIRMATION_DETECTION' }, application.id, job.id);
      const confirmation = await adapter.checkConfirmation(page);

      if (applicationCompleted || confirmation.isConfirmed) {
        screenshotPath = await this.browserManager.captureScreenshot(
          page,
          `submitted_${application.id}.png`
        ).catch(() => undefined);

        await prisma.application.update({
          where: { id: application.id },
          data: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
            confirmationText: confirmation.confirmationText || 'Application completed successfully',
          },
        });

        await prisma.job.update({
          where: { id: job.id },
          data: { status: 'SUBMITTED' },
        });

        await this.logEvent(
          'STATE_CHANGE',
          {
            to: 'SUBMITTED',
            confirmation: confirmation.confirmationText || 'Success',
            screenshot: screenshotPath,
          },
          application.id,
          job.id
        );

        return {
          applicationId: application.id,
          finalState: 'SUBMITTED',
          success: true,
          confirmationText: confirmation.confirmationText || 'Application successfully submitted',
          screenshotPath,
        };
      } else {
        screenshotPath = await this.browserManager.captureScreenshot(
          page,
          `unconfirmed_${application.id}.png`
        ).catch(() => undefined);

        await this.handleFailure(
          application.id,
          job.id,
          'SUBMISSION_FAILED',
          'Application process finished without definitive confirmation'
        );

        return {
          applicationId: application.id,
          finalState: 'SUBMISSION_FAILED',
          success: false,
          error: 'Did not detect application confirmation',
          screenshotPath,
        };
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      screenshotPath = page ? await this.browserManager.captureScreenshot(page, `error_${application.id}.png`).catch(() => undefined) : undefined;

      await this.handleFailure(application.id, job.id, 'SUBMISSION_FAILED', errorMsg);

      return {
        applicationId: application.id,
        finalState: 'SUBMISSION_FAILED',
        success: false,
        error: errorMsg,
        screenshotPath,
      };
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  private async handleFailure(
    applicationId: string,
    jobId: string,
    state: ApplicationState,
    reason: string
  ): Promise<void> {
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: 'FAILED' },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: { status: state },
    });

    await this.logEvent('STATE_CHANGE', { to: state, reason }, applicationId, jobId);
  }

  async close(): Promise<void> {
    await this.browserManager.close();
  }
}
