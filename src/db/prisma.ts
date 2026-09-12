import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function resolveDatabaseUrl(): string {
  const envUrl = process.env.DATABASE_URL;

  // Cloud URL provided (Turso, Postgres, LibSQL, etc.)
  if (envUrl && !envUrl.startsWith('file:')) {
    return envUrl;
  }

  // Running on Vercel or AWS Lambda with read-only file system
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (isServerless) {
    const tmpDbPath = path.join('/tmp', 'app.sqlite');
    if (!fs.existsSync(tmpDbPath)) {
      const candidatePaths = [
        path.join(process.cwd(), 'prisma', 'seed-template.sqlite'),
        path.join(__dirname, '..', '..', 'prisma', 'seed-template.sqlite'),
        path.join('/var/task', 'prisma', 'seed-template.sqlite'),
      ];

      for (const candidate of candidatePaths) {
        if (fs.existsSync(/* turbopackIgnore: true */ candidate)) {
          try {
            fs.copyFileSync(candidate, tmpDbPath);
            break;
          } catch (e) {
            console.warn(`[Prisma] Failed to copy template from ${candidate}:`, e);
          }
        }
      }
    }
    return `file:${tmpDbPath}`;
  }

  return envUrl || 'file:./dev.db';
}

const resolvedUrl = resolveDatabaseUrl();
process.env.DATABASE_URL = resolvedUrl;

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: resolvedUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;

