// Prisma Client singleton for Next.js / Node.js
// In local/production, this initializes PrismaClient with DATABASE_URL
let prismaClientInstance: any = null;

export function getPrisma() {
  if (!prismaClientInstance) {
    try {
      // Dynamic require to prevent crash if @prisma/client is not yet generated in build
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaClient } = require('@prisma/client');
      const globalForPrisma = globalThis as unknown as { prisma: any };
      prismaClientInstance = globalForPrisma.prisma || new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      });
      if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaClientInstance;
    } catch {
      console.warn('[Prisma] @prisma/client not found or not initialized yet.');
    }
  }
  return prismaClientInstance;
}

export const prisma: any = new Proxy({}, {
  get(_target, prop) {
    const client = getPrisma();
    if (!client) {
      throw new Error('PrismaClient is not initialized. Run `npx prisma generate` and configure DATABASE_URL.');
    }
    return client[prop];
  }
});
