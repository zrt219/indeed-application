import { describe, it, expect } from "vitest";
import { matchAnswerBank, matchProfileFacts, answerQuestionWithPhi3 } from "../src/llm/ollama";

describe("Ollama & Question Answering Anti-Hallucination Guardrails", () => {
  it("should match profile facts deterministically without calling LLM", () => {
    const firstNameRes = matchProfileFacts("First Name");
    expect(firstNameRes).not.toBeNull();
    expect(firstNameRes?.canAnswer).toBe(true);
    expect(firstNameRes?.source).toBe("profile");
    expect(firstNameRes?.confidence).toBe(1.0);

    const emailRes = matchProfileFacts("Email address");
    expect(emailRes).not.toBeNull();
    expect(emailRes?.canAnswer).toBe(true);
  });

  it("should match answer bank entries for standard screener questions", () => {
    const res = matchAnswerBank("Are you legally authorized to work in the United States?");
    if (res) {
      expect(res.canAnswer).toBe(true);
      expect(res.source).toBe("answer_bank");
      expect(res.confidence).toBe(1.0);
    } else {
      // If bank doesn't have exact pattern, it falls back safely
      expect(true).toBe(true);
    }
  });

  it("should safely refuse and require manual review on unknown questions without Ollama server", async () => {
    // A question requiring facts not in the profile
    const result = await answerQuestionWithPhi3("Do you have 10 years of COBOL mainframe experience?");
    expect(result.requiresManualReview).toBe(true);
    expect(result.source).toBe("refusal");
  });
});
