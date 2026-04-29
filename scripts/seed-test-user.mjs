import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { hash } from 'bcrypt-ts';

const TEST_EMAIL = 'test@local.test';
const TEST_PASSWORD = 'test1234';
const TEST_NAME = 'Tài khoản test';

const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const adapter = new PrismaBetterSqlite3({ url });
const prisma = new PrismaClient({ adapter });

const passwordHash = await hash(TEST_PASSWORD, 12);

const user = await prisma.user.upsert({
  where: { email: TEST_EMAIL },
  update: { passwordHash, name: TEST_NAME },
  create: { email: TEST_EMAIL, passwordHash, name: TEST_NAME },
});

console.log(`OK: ${user.email} / ${TEST_PASSWORD}`);
await prisma.$disconnect();
