import { Page } from 'playwright';
import { CandidateProfile } from '../../qualification/engine';
import { AnswerBankEntry } from '../../llm/ollama';

export interface FillStepOptions {
  profile: CandidateProfile;
  answerBank: AnswerBankEntry[];
  resumeFilePath?: string;
  onQuestionUnanswered?: (question: string, context?: string) => Promise<string | null>;
}

export interface StepFillResult {
  filledFields: number;
  unansweredFields: { label: string; selector: string; reason?: string }[];
  requiresManualReview: boolean;
  manualReviewReason?: string;
}

export interface StepAdvanceResult {
  movedNext: boolean;
  isComplete: boolean;
  hasErrors: boolean;
  errorMessage?: string;
}

export interface ConfirmationResult {
  isConfirmed: boolean;
  confirmationText?: string;
}

export interface SiteAdapter {
  name: string;
  canHandle(url: string): boolean;
  startApplication(page: Page, jobUrl: string): Promise<{ success: boolean; error?: string }>;
  fillCurrentStep(page: Page, options: FillStepOptions): Promise<StepFillResult>;
  advanceStep(page: Page): Promise<StepAdvanceResult>;
  checkConfirmation(page: Page): Promise<ConfirmationResult>;
}
