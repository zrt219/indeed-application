import { describe, it, expect } from "vitest";
import { calculateFitScore, checkHardExclusions, loadDefaultProfile, JobInput } from "../src/qualification/engine";

describe("Qualification Engine & Synthetic Jobs Suite", () => {
  const defaultProfile = loadDefaultProfile();

  it("should evaluate a direct match full stack developer with high score", () => {
    const job: JobInput = {
      title: "Full Stack Software Engineer",
      employer: "Austin Tech Partners",
      location: "Austin, TX",
      description: "Seeking a Full Stack Engineer with TypeScript, React, Next.js, Node.js, and SQL.",
      url: "https://indeed.com/viewjob?jk=synth-1"
    };

    const result = calculateFitScore(job, defaultProfile);
    expect(result.isExcluded).toBe(false);
    expect(result.fitScore).toBeGreaterThanOrEqual(75);
    expect(["STRONG_MATCH", "GOOD_MATCH"]).toContain(result.recommendation);
  });

  it("should exclude jobs requiring active security clearance when candidate has none", () => {
    const job: JobInput = {
      title: "Defense Software Engineer",
      employer: "AeroSec Defense",
      description: "Must possess Active Top Secret Clearance with polygraph.",
      url: "https://indeed.com/viewjob?jk=synth-clearance"
    };

    const exclusion = checkHardExclusions(job, defaultProfile);
    expect(exclusion.isExcluded).toBe(true);
    expect(exclusion.reasons.length).toBeGreaterThan(0);

    const result = calculateFitScore(job, defaultProfile);
    expect(result.fitScore).toBe(0);
    expect(result.recommendation).toBe("EXCLUDED");
  });

  it("should score low on completely unrelated non-tech jobs", () => {
    const job: JobInput = {
      title: "Registered Dental Hygienist",
      employer: "Smile Care LLC",
      location: "Austin, TX",
      description: "Clean teeth, take X-rays, patient oral health care.",
      url: "https://indeed.com/viewjob?jk=synth-dental"
    };

    const result = calculateFitScore(job, defaultProfile);
    expect(result.fitScore).toBeLessThan(35);
  });

  // 10 Synthetic varied jobs with realistic descriptions
  const testCases = [
    { title: "React Frontend Engineer", desc: "Building UI components in React and TypeScript.", shouldMatch: true },
    { title: "Node.js Backend Developer", desc: "Node.js and Express REST API development with PostgreSQL/SQLite.", shouldMatch: true },
    { title: "Senior Full Stack Engineer", desc: "Full stack TypeScript, React, Next.js developer.", shouldMatch: true },
    { title: "Heavy Truck Driver Class A", desc: "Drive commercial motor vehicles over long haul routes.", shouldMatch: false },
    { title: "Forklift Operator Warehouse", desc: "Operate forklift, load pallets, warehouse logistics.", shouldMatch: false },
    { title: "TypeScript Web Developer", desc: "Frontend and full stack TypeScript web development.", shouldMatch: true },
    { title: "Pastry Chef Baker", desc: "Baking bread, cakes, pastries in commercial kitchen.", shouldMatch: false },
    { title: "Registered Nurse ICU", desc: "Critical care nursing in hospital intensive care unit.", shouldMatch: false }
  ];

  testCases.forEach((tc, idx) => {
    it(`evaluates synthetic job #${idx + 1}: ${tc.title}`, () => {
      const res = calculateFitScore({ title: tc.title, description: tc.desc }, defaultProfile);
      if (tc.shouldMatch) {
        expect(res.fitScore).toBeGreaterThanOrEqual(45);
      } else {
        expect(res.fitScore).toBeLessThan(35);
      }
    });
  });
});
