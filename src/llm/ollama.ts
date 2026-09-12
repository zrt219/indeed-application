import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { loadDefaultProfile } from '../qualification/engine';

export const QuestionAnswerResponseSchema = z.object({
  canAnswer: z.boolean().describe('Whether the question can be confidently answered from candidate profile or answer bank'),
  answer: z.string().optional().describe('The formatted answer string to be entered into the form input'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0.0 to 1.0'),
  source: z.enum(['answer_bank', 'profile', 'refusal']).describe('Where the answer originated from'),
  refusalReason: z.string().optional().describe('Reason for refusal if the question cannot be answered factually'),
  requiresManualReview: z.boolean().describe('Whether manual human intervention is required before proceeding'),
  suggestedInputType: z.enum(['text', 'number', 'boolean', 'select', 'textarea', 'unknown']).default('text'),
});

export type QuestionAnswerResponse = z.infer<typeof QuestionAnswerResponseSchema>;

export interface AnswerBankEntry {
  id: string;
  category: string;
  patterns: string[];
  answer: string;
  booleanValue?: boolean;
  numericValue?: number;
  confidence: number;
  notes?: string;
}

export function loadAnswerBank(): AnswerBankEntry[] {
  const bankPath = path.resolve(process.cwd(), 'data', 'answer-bank.json');
  if (fs.existsSync(bankPath)) {
    try {
      const content = fs.readFileSync(bankPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Fast-path pre-verified pattern matcher against answer bank.
 * Zero-hallucination deterministic matching.
 */
export function matchAnswerBank(questionText: string, bank: AnswerBankEntry[] = loadAnswerBank()): QuestionAnswerResponse | null {
  const normalizedQuestion = questionText.toLowerCase().trim();

  // Collect all matching patterns to find the longest (most specific) match
  let bestMatch: { entry: AnswerBankEntry; matchedLength: number } | null = null;

  for (const entry of bank) {
    for (const pattern of entry.patterns) {
      const p = pattern.toLowerCase();
      if (normalizedQuestion.includes(p)) {
        if (!bestMatch || p.length > bestMatch.matchedLength) {
          bestMatch = { entry, matchedLength: p.length };
        }
      }
    }
  }

  if (bestMatch) {
    const entry = bestMatch.entry;
    let inputType: QuestionAnswerResponse['suggestedInputType'] = 'text';
    if (entry.booleanValue !== undefined) inputType = 'boolean';
    else if (entry.numericValue !== undefined) inputType = 'number';

    return {
      canAnswer: true,
      answer: entry.answer,
      confidence: entry.confidence,
      source: 'answer_bank',
      requiresManualReview: false,
      suggestedInputType: inputType,
    };
  }

  return null;
}

/**
 * Checks if question is asking for personal profile facts directly
 */
export function matchProfileFacts(questionText: string, profile = loadDefaultProfile()): QuestionAnswerResponse | null {
  const q = questionText.toLowerCase().trim();

  // Full Name
  if (q.includes('full name') || q.includes('your name') || q === 'name') {
    return {
      canAnswer: true,
      answer: profile.personal.fullName,
      confidence: 1.0,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'text',
    };
  }

  // First Name
  if (q.includes('first name') || q.includes('given name')) {
    const firstName = profile.personal.fullName.split(' ')[0];
    return {
      canAnswer: true,
      answer: firstName,
      confidence: 1.0,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'text',
    };
  }

  // Last Name
  if (q.includes('last name') || q.includes('surname') || q.includes('family name')) {
    const parts = profile.personal.fullName.split(' ');
    const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
    return {
      canAnswer: true,
      answer: lastName,
      confidence: 1.0,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'text',
    };
  }

  // Email
  if (q.includes('email') || q.includes('email address')) {
    return {
      canAnswer: true,
      answer: (profile.personal as unknown as { email?: string }).email || 'alex.rivera.dev@example.com',
      confidence: 1.0,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'text',
    };
  }

  // Phone
  if (q.includes('phone') || q.includes('mobile') || q.includes('telephone') || q.includes('contact number')) {
    return {
      canAnswer: true,
      answer: (profile.personal as unknown as { phone?: string }).phone || '+1-555-019-2834',
      confidence: 1.0,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'text',
    };
  }

  // City / Location
  if (q.includes('city') || q.includes('current location') || q.includes('where are you based')) {
    return {
      canAnswer: true,
      answer: `${profile.personal.location.city}, ${profile.personal.location.state}`,
      confidence: 1.0,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'text',
    };
  }

  // LinkedIn
  if (q.includes('linkedin')) {
    return {
      canAnswer: true,
      answer: 'https://linkedin.com/in/alex-rivera-dev',
      confidence: 1.0,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'text',
    };
  }

  // GitHub
  if (q.includes('github')) {
    return {
      canAnswer: true,
      answer: 'https://github.com/alexrivera-dev',
      confidence: 1.0,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'text',
    };
  }

  // Target Roles / Seniority
  if (q.includes('years of experience') || q.includes('how many years')) {
    return {
      canAnswer: true,
      answer: String(profile.yearsOfExperience),
      confidence: 0.95,
      source: 'profile',
      requiresManualReview: false,
      suggestedInputType: 'number',
    };
  }

  return null;
}

/**
 * Strict Anti-Hallucination Ollama Phi-3 caller
 */
export async function answerQuestionWithPhi3(
  question: string,
  fieldOptions?: string[],
  context?: string
): Promise<QuestionAnswerResponse> {
  // Step 1: Pre-verified answer bank match (Deterministic)
  const bankMatch = matchAnswerBank(question);
  if (bankMatch) {
    return bankMatch;
  }

  // Step 2: Direct profile match
  const profileMatch = matchProfileFacts(question);
  if (profileMatch) {
    return profileMatch;
  }

  // Step 3: Local Ollama LLM call with strict anti-hallucination prompt & Zod schema
  const profile = loadDefaultProfile();
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'phi3:latest';

  const systemPrompt = `You are a strict, zero-hallucination automated job application question answering system.
You MUST ONLY answer based on the verified facts provided below.

VERIFIED CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

OPTIONS AVAILABLE (if multiple choice/dropdown):
${fieldOptions && fieldOptions.length > 0 ? JSON.stringify(fieldOptions) : 'None'}

CONTEXT:
${context || 'No additional context'}

CRITICAL RULES:
1. If the exact answer or unambiguous fact is NOT present in the candidate profile, you MUST set "canAnswer": false, "requiresManualReview": true, and explain the missing fact in "refusalReason".
2. NEVER guess, assume, fabricate, or extrapolate unmentioned skills, certifications, work history, or personal traits.
3. If options are provided, select the one that most accurately matches verified facts. If none match, set "canAnswer": false.
4. Confidence must be between 0.0 and 1.0. If you are not 100% certain based on stated facts, set confidence < 0.8 and "requiresManualReview": true.

OUTPUT FORMAT:
Respond with ONLY a valid JSON object matching this schema:
{
  "canAnswer": boolean,
  "answer": string or undefined,
  "confidence": number,
  "source": "profile" or "refusal",
  "refusalReason": string or undefined,
  "requiresManualReview": boolean,
  "suggestedInputType": "text" | "number" | "boolean" | "select" | "textarea" | "unknown"
}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `Question: "${question}"\n\nReturn JSON response:`,
        system: systemPrompt,
        format: 'json',
        stream: false,
        options: {
          temperature: 0.0, // Strict deterministic output
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        canAnswer: false,
        confidence: 0.0,
        source: 'refusal',
        refusalReason: `Ollama service returned HTTP status ${response.status}`,
        requiresManualReview: true,
        suggestedInputType: 'text',
      };
    }

    const data = await response.json();
    const rawContent = data.response;

    const parsedJson = JSON.parse(rawContent);
    const validated = QuestionAnswerResponseSchema.safeParse(parsedJson);

    if (validated.success) {
      if (validated.data.confidence < 0.8) {
        return {
          ...validated.data,
          requiresManualReview: true,
        };
      }
      return validated.data;
    } else {
      return {
        canAnswer: false,
        confidence: 0.0,
        source: 'refusal',
        refusalReason: 'Ollama output did not match expected schema format',
        requiresManualReview: true,
        suggestedInputType: 'text',
      };
    }
  } catch {
    // If Ollama is offline or timed out, gracefully refuse and route to manual review
    return {
      canAnswer: false,
      confidence: 0.0,
      source: 'refusal',
      refusalReason: 'Local Ollama Phi-3 inference unavailable or question requires manual human clarification',
      requiresManualReview: true,
      suggestedInputType: 'text',
    };
  }
}
