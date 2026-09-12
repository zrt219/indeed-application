import path from 'path';
import { prisma } from '../../../src/db/prisma';

/**
 * Returns a normalized file:// URL for an HTML fixture
 */
export function getFixtureUrl(filename: string): string {
  const absolutePath = path.resolve(__dirname, '../fixtures', filename);
  const normalized = absolutePath.replace(/\\/g, '/');
  return `file:///${normalized.startsWith('/') ? normalized.substring(1) : normalized}`;
}

/**
 * Cleans up only E2E test-generated records scoped to a specific tier/suite.
 * Prevents cross-file cascade deletes when running sequential or parallel test suites.
 */
export async function cleanE2ETestData(scope: string = 'e2e'): Promise<void> {
  try {
    await prisma.outboxEvent.deleteMany({
      where: {
        OR: [
          { id: { startsWith: scope } },
          { payload: { contains: scope } },
        ],
      },
    });
    await prisma.job.deleteMany({
      where: {
        OR: [
          { url: { contains: scope } },
          { title: { contains: scope.toUpperCase() } },
        ],
      },
    });
  } catch {
    // Resilient cleanup ignores temporary busy locks
  }
}
