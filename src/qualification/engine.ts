import fs from 'fs';
import path from 'path';

export interface JobInput {
  title: string;
  employer?: string;
  location?: string;
  description?: string;
  url?: string;
}

export interface CandidateProfile {
  personal: {
    fullName: string;
    location: {
      city: string;
      state: string;
      country: string;
    };
  };
  workAuthorization: {
    usAuthorized: boolean;
    requiresSponsorship: boolean;
    citizenshipStatus: string;
    securityClearance: string;
  };
  targetRoles: string[];
  seniority: string;
  yearsOfExperience: number;
  skills: {
    languages?: string[];
    frontend?: string[];
    backend?: string[];
    database?: string[];
    cloudAndDevops?: string[];
    testing?: string[];
  };
  preferences: {
    workMode: string[];
    desiredSalary?: {
      minimum: number;
      target: number;
    };
    willingToRelocate: boolean;
  };
}

export interface QualificationResult {
  fitScore: number; // 0 - 100
  isExcluded: boolean;
  exclusionReasons: string[];
  breakdown: {
    titleScore: number; // max 35
    skillScore: number; // max 35
    experienceScore: number; // max 20
    locationScore: number; // max 10
  };
  matchedSkills: string[];
  missingSkills: string[];
  recommendation: 'STRONG_MATCH' | 'GOOD_MATCH' | 'MODERATE_MATCH' | 'LOW_MATCH' | 'EXCLUDED';
}

/**
 * Load default profile from data/profile.json
 */
export function loadDefaultProfile(): CandidateProfile {
  const profilePath = path.resolve(process.cwd(), 'data', 'profile.json');
  if (fs.existsSync(profilePath)) {
    const raw = fs.readFileSync(profilePath, 'utf-8');
    return JSON.parse(raw);
  }
  return {
    personal: {
      fullName: 'Alex Rivera',
      location: { city: 'Austin', state: 'Texas', country: 'United States' },
    },
    workAuthorization: {
      usAuthorized: true,
      requiresSponsorship: false,
      citizenshipStatus: 'US Citizen',
      securityClearance: 'None',
    },
    targetRoles: ['Full Stack Software Engineer', 'Senior Full Stack Engineer', 'Software Engineer'],
    seniority: 'Senior',
    yearsOfExperience: 6,
    skills: {
      languages: ['TypeScript', 'JavaScript', 'Python', 'SQL'],
      frontend: ['React', 'Next.js', 'Tailwind CSS'],
      backend: ['Node.js', 'Express', 'Prisma'],
      database: ['PostgreSQL', 'SQLite'],
    },
    preferences: {
      workMode: ['Remote', 'Hybrid'],
      willingToRelocate: false,
    },
  };
}

/**
 * Evaluates hard exclusion rules
 */
export function checkHardExclusions(job: JobInput, profile: CandidateProfile): { isExcluded: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const text = `${job.title} ${job.location || ''} ${job.description || ''}`.toLowerCase();

  // 1. Security Clearance exclusion
  if (
    profile.workAuthorization.securityClearance === 'None' &&
    (text.includes('active secret clearance') ||
      text.includes('top secret clearance') ||
      text.includes('ts/sci') ||
      text.includes('polygraph') ||
      text.includes('dod clearance required'))
  ) {
    reasons.push('Requires active Department of Defense or Intelligence Security Clearance');
  }

  // 2. Visa Sponsorship exclusion
  if (
    profile.workAuthorization.requiresSponsorship &&
    (text.includes('no sponsorship') ||
      text.includes('unable to sponsor') ||
      text.includes('does not offer sponsorship') ||
      text.includes('not offering visa sponsorship'))
  ) {
    reasons.push('Role explicitly states no visa sponsorship available');
  }

  // 3. Unpaid / Volunteer / Exploitative roles
  if (
    text.includes('unpaid internship') ||
    text.includes('commission only') ||
    text.includes('volunteer position')
  ) {
    reasons.push('Unpaid, volunteer, or commission-only position');
  }

  // 4. Incompatible Seniority
  const titleLower = job.title.toLowerCase();
  const cSuiteOrDirector = ['vp of', 'vice president', 'director of', 'chief technology officer', 'cto', 'chief executive'];
  if (cSuiteOrDirector.some((prefix) => titleLower.includes(prefix)) && profile.seniority !== 'Executive') {
    reasons.push('Seniority level exceeds target profile (Executive/Director)');
  }

  // 5. Strict On-site in Non-target location
  const locationLower = (job.location || '').toLowerCase();
  const isExplicitlyRemote = locationLower.includes('remote') || text.includes('100% remote') || text.includes('fully remote');
  const isCandidateCity = locationLower.includes(profile.personal.location.city.toLowerCase()) ||
    locationLower.includes(profile.personal.location.state.toLowerCase());

  if (!isExplicitlyRemote && !profile.preferences.willingToRelocate && locationLower.length > 3) {
    // If it's strictly on-site in a far away state and mentions on-site
    const isOnsite = text.includes('on-site only') || text.includes('must be located in-office') || text.includes('no remote');
    if (isOnsite && !isCandidateCity) {
      reasons.push(`Strict on-site requirement in non-target location: ${job.location}`);
    }
  }

  return {
    isExcluded: reasons.length > 0,
    reasons,
  };
}

/**
 * Computes the 0-100 FIT score
 */
export function calculateFitScore(job: JobInput, profile: CandidateProfile = loadDefaultProfile()): QualificationResult {
  const exclusion = checkHardExclusions(job, profile);

  if (exclusion.isExcluded) {
    return {
      fitScore: 0,
      isExcluded: true,
      exclusionReasons: exclusion.reasons,
      breakdown: {
        titleScore: 0,
        skillScore: 0,
        experienceScore: 0,
        locationScore: 0,
      },
      matchedSkills: [],
      missingSkills: [],
      recommendation: 'EXCLUDED',
    };
  }

  const titleLower = job.title.toLowerCase();
  const descLower = (job.description || '').toLowerCase();
  const combinedText = `${titleLower} ${descLower}`;

  // 1. Title Match (Max 35)
  let titleScore = 0;
  for (const role of profile.targetRoles) {
    const roleLower = role.toLowerCase();
    if (titleLower === roleLower) {
      titleScore = 35;
      break;
    } else if (titleLower.includes(roleLower) || roleLower.includes(titleLower)) {
      titleScore = Math.max(titleScore, 30);
    } else {
      // Partial word overlap
      const roleWords = roleLower.split(/\s+/).filter((w) => w.length > 2);
      const matchedWords = roleWords.filter((w) => titleLower.includes(w));
      const overlapRatio = matchedWords.length / roleWords.length;
      if (overlapRatio >= 0.5) {
        titleScore = Math.max(titleScore, Math.round(overlapRatio * 25));
      }
    }
  }

  // 2. Skills Match (Max 35)
  const allProfileSkills = Object.values(profile.skills).flat();
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];

  for (const skill of allProfileSkills) {
    const skillNorm = skill.toLowerCase().replace(/[()]/g, '');
    const regex = new RegExp(`\\b${escapeRegExp(skillNorm)}\\b`, 'i');
    if (regex.test(combinedText)) {
      matchedSkills.push(skill);
    } else {
      missingSkills.push(skill);
    }
  }

  let skillScore = 0;
  if (allProfileSkills.length > 0) {
    const matchRatio = matchedSkills.length / Math.min(allProfileSkills.length, 12);
    skillScore = Math.min(35, Math.round(matchRatio * 35));
  }

  // 3. Experience & Seniority Match (Max 20)
  let experienceScore = 15; // default reasonable base
  if (combinedText.includes('senior') || combinedText.includes('lead')) {
    if (profile.seniority === 'Senior' || profile.yearsOfExperience >= 5) {
      experienceScore = 20;
    } else {
      experienceScore = 10;
    }
  } else if (combinedText.includes('junior') || combinedText.includes('entry level')) {
    if (profile.seniority === 'Junior') {
      experienceScore = 20;
    } else {
      experienceScore = 12; // overqualified
    }
  }

  // 4. Location & Work Mode Match (Max 10)
  let locationScore = 5;
  const locLower = (job.location || '').toLowerCase();
  const candidateCity = profile.personal.location.city.toLowerCase();

  if (locLower.includes('remote') || combinedText.includes('remote') || combinedText.includes('work from anywhere')) {
    locationScore = 10;
  } else if (locLower.includes(candidateCity) || locLower.includes(profile.personal.location.state.toLowerCase())) {
    locationScore = 10;
  } else if (locLower.includes('hybrid') && locLower.includes(candidateCity)) {
    locationScore = 10;
  } else if (!locLower || locLower === 'united states' || locLower === 'us') {
    locationScore = 7;
  }

  const fitScore = Math.min(100, Math.max(0, titleScore + skillScore + experienceScore + locationScore));

  let recommendation: QualificationResult['recommendation'] = 'LOW_MATCH';
  if (fitScore >= 80) recommendation = 'STRONG_MATCH';
  else if (fitScore >= 65) recommendation = 'GOOD_MATCH';
  else if (fitScore >= 50) recommendation = 'MODERATE_MATCH';

  return {
    fitScore,
    isExcluded: false,
    exclusionReasons: [],
    breakdown: {
      titleScore,
      skillScore,
      experienceScore,
      locationScore,
    },
    matchedSkills,
    missingSkills,
    recommendation,
  };
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
