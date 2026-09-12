import { describe, it, expect } from 'vitest';
import {
  matchAnswerBank,
  matchProfileFacts,
  answerQuestionWithPhi3,
  QuestionAnswerResponseSchema,
  loadAnswerBank,
} from '../../src/llm/ollama';

describe('LLM & Screening Anti-Hallucination Guardrails', () => {
  const bank = loadAnswerBank();

  describe('Deterministic Answer Bank Matching', () => {
    it('should accurately resolve work authorization questions from bank', () => {
      const q = 'Are you legally authorized to work in the United States?';
      const result = matchAnswerBank(q, bank);
      expect(result).not.toBeNull();
      expect(result?.canAnswer).toBe(true);
      expect(result?.answer).toBe('Yes');
      expect(result?.confidence).toBe(1.0);
      expect(result?.source).toBe('answer_bank');
      expect(result?.requiresManualReview).toBe(false);
    });

    it('should accurately resolve visa sponsorship questions from bank', () => {
      const q = 'Will you now or in the future require visa sponsorship?';
      const result = matchAnswerBank(q, bank);
      expect(result).not.toBeNull();
      expect(result?.canAnswer).toBe(true);
      expect(result?.answer).toBe('No');
      expect(result?.confidence).toBe(1.0);
      expect(result?.requiresManualReview).toBe(false);
    });

    it('should accurately resolve experience questions from bank', () => {
      const q = 'How many years of experience with TypeScript do you have?';
      const result = matchAnswerBank(q, bank);
      expect(result).not.toBeNull();
      expect(result?.canAnswer).toBe(true);
      expect(result?.answer).toBe('5');
      expect(result?.suggestedInputType).toBe('number');
    });
  });

  describe('Profile Direct Fact Extraction', () => {
    it('should extract full name, email, and phone reliably', () => {
      const nameResult = matchProfileFacts('What is your full name?');
      expect(nameResult?.answer).toBe('Alex Rivera');
      expect(nameResult?.source).toBe('profile');

      const emailResult = matchProfileFacts('Please enter your email address:');
      expect(emailResult?.answer).toBe('alex.rivera.dev@example.com');

      const phoneResult = matchProfileFacts('Primary contact phone number:');
      expect(phoneResult?.answer).toBe('+1-555-019-2834');
    });

    it('should extract city and location', () => {
      const locResult = matchProfileFacts('Current location / city:');
      expect(locResult?.answer).toContain('Austin');
    });
  });

  describe('Anti-Hallucination & Refusal on Unknown Facts', () => {
    it('should refuse to guess and require manual review for unmentioned skills or unknown questions', async () => {
      // Question asking for something completely missing from profile (e.g. COBOL or Pilot license)
      const unknownQ = 'Do you hold a commercial pilot license (FAA Part 107)?';
      const res = await answerQuestionWithPhi3(unknownQ);

      // Must never guess a hallucinated answer
      expect(res.canAnswer).toBe(false);
      expect(res.requiresManualReview).toBe(true);
      expect(res.source).toBe('refusal');
      expect(res.refusalReason).toBeDefined();
    });

    it('should validate answer structure against Zod schema', async () => {
      const validPayload = {
        canAnswer: true,
        answer: 'Yes',
        confidence: 0.95,
        source: 'answer_bank',
        requiresManualReview: false,
        suggestedInputType: 'boolean',
      };

      const parsed = QuestionAnswerResponseSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);

      const invalidPayload = {
        canAnswer: 'maybe', // invalid type
        confidence: 2.5, // out of range
      };
      const invalidParsed = QuestionAnswerResponseSchema.safeParse(invalidPayload);
      expect(invalidParsed.success).toBe(false);
    });
  });
});
