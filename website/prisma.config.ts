import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/warranty_vault_dev';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
});
