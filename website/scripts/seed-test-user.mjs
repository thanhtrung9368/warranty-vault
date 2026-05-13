import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt-ts';

const TEST_EMAIL = 'test@local.test';
const TEST_PASSWORD = 'test1234';
const TEST_NAME = 'Tài khoản test';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/warranty_vault_dev';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const passwordHash = await hash(TEST_PASSWORD, 12);

const user = await prisma.user.upsert({
  where: { email: TEST_EMAIL },
  update: { passwordHash, name: TEST_NAME },
  create: { email: TEST_EMAIL, passwordHash, name: TEST_NAME },
});

console.log(`OK: ${user.email} / ${TEST_PASSWORD}`);
await prisma.$disconnect();
