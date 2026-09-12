import { describe, it, expect } from 'vitest';
import {
  calculateFitScore,
  checkHardExclusions,
  loadDefaultProfile,
  JobInput,
} from '../../src/qualification/engine';

describe('Qualification Engine', () => {
  const profile = loadDefaultProfile();

  describe('Hard Exclusion Rules', () => {
    it('should exclude jobs requiring active security clearance when candidate has none', () => {
      const job: JobInput = {
        title: 'Senior Software Engineer',
        employer: 'Defense contractor',
        description: 'Candidate must possess an active Top Secret Clearance (TS/SCI).',
      };

      const result = checkHardExclusions(job, profile);
      expect(result.isExcluded).toBe(true);
      expect(result.reasons[0]).toContain('Security Clearance');

      const fullResult = calculateFitScore(job, profile);
      expect(fullResult.fitScore).toBe(0);
      expect(fullResult.isExcluded).toBe(true);
      expect(fullResult.recommendation).toBe('EXCLUDED');
    });

    it('should exclude unpaid or volunteer roles', () => {
      const job: JobInput = {
        title: 'Full Stack Developer',
        employer: 'Startup',
        description: 'This is an unpaid internship for course credit only.',
      };

      const result = checkHardExclusions(job, profile);
      expect(result.isExcluded).toBe(true);
      expect(result.reasons[0]).toContain('Unpaid');
    });

    it('should exclude executive C-level or Director roles for non-executive profile', () => {
      const job: JobInput = {
        title: 'VP of Engineering',
        employer: 'Enterprise Corp',
        description: 'Lead an organization of 200+ developers.',
      };

      const result = checkHardExclusions(job, profile);
      expect(result.isExcluded).toBe(true);
      expect(result.reasons[0]).toContain('Executive');
    });

    it('should pass jobs without hard exclusions', () => {
      const job: JobInput = {
        title: 'Senior Full Stack Engineer',
        employer: 'TechCorp',
        location: 'Remote',
        description: 'Looking for a Senior TypeScript and React developer.',
      };

      const result = checkHardExclusions(job, profile);
      expect(result.isExcluded).toBe(false);
      expect(result.reasons.length).toBe(0);
    });
  });

  describe('FIT Score Calculation', () => {
    it('should calculate high score for exact matching role and skills', () => {
      const job: JobInput = {
        title: 'Senior Full Stack Engineer',
        employer: 'Cloud Innovators',
        location: 'Remote',
        description:
          'We need an experienced Senior Engineer with TypeScript, React, Next.js, Node.js, PostgreSQL, and AWS.',
      };

      const result = calculateFitScore(job, profile);
      expect(result.isExcluded).toBe(false);
      expect(result.fitScore).toBeGreaterThanOrEqual(80);
      expect(result.recommendation).toBe('STRONG_MATCH');
      expect(result.breakdown.titleScore).toBe(35);
      expect(result.matchedSkills).toContain('TypeScript');
      expect(result.matchedSkills).toContain('React');
      expect(result.matchedSkills).toContain('Next.js');
    });

    it('should calculate moderate score for partial match', () => {
      const job: JobInput = {
        title: 'Software Developer',
        employer: 'Generic Tech',
        location: 'Remote',
        description: 'Working with Python and SQL databases.',
      };

      const result = calculateFitScore(job, profile);
      expect(result.isExcluded).toBe(false);
      expect(result.fitScore).toBeGreaterThanOrEqual(40);
      expect(result.fitScore).toBeLessThan(80);
    });

    it('should give location bonus for Austin TX or Remote', () => {
      const jobRemote: JobInput = {
        title: 'Full Stack Engineer',
        location: 'Remote',
        description: 'TypeScript developer',
      };
      const jobAustin: JobInput = {
        title: 'Full Stack Engineer',
        location: 'Austin, TX',
        description: 'TypeScript developer',
      };

      const resRemote = calculateFitScore(jobRemote, profile);
      const resAustin = calculateFitScore(jobAustin, profile);

      expect(resRemote.breakdown.locationScore).toBe(10);
      expect(resAustin.breakdown.locationScore).toBe(10);
    });
  });
});
