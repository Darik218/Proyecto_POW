"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("../src/generated/prisma/client");
const seed_catalog_1 = require("./seed-catalog");
async function main() { const connectionString = process.env.DATABASE_URL; if (!connectionString)
    throw new Error('DATABASE_URL is required.'); const prisma = new client_1.PrismaClient({ adapter: new adapter_pg_1.PrismaPg({ connectionString }) }); try {
    const result = await (0, seed_catalog_1.seedCatalog)(prisma);
    console.log(`Catalog: ${result.count} stable global exercises, ${result.inserted} newly inserted, ${result.aliases} aliases.`);
}
finally {
    await prisma.$disconnect();
} }
main().catch(() => { console.error('Exercise catalog seed failed. Inspect migrations and catalog constraints; connection secrets are not logged.'); process.exitCode = 1; });
