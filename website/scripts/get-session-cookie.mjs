// Mints an iron-session cookie for the test user. Print to stdout so curl can use it.
import 'dotenv/config';
import { sealData } from 'iron-session';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/warranty_vault_dev';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const user = await prisma.user.findUnique({ where: { email: 'test@local.test' } });
if (!user) throw new Error('test user missing');

const password = process.env.SESSION_SECRET;
if (!password || password.length < 32) throw new Error('SESSION_SECRET must be ≥32 chars');

const sealed = await sealData(
  {
    userId: user.id,
    email: user.email,
    passwordChangedAt: Date.now(),
  },
  { password, ttl: 60 * 60 * 24 * 7 },
);

console.log(`wv_session=${sealed}`);
await prisma.$disconnect();
