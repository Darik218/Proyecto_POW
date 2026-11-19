import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedCatalog } from './seed-catalog';
async function main(){const connectionString=process.env.DATABASE_URL;if(!connectionString)throw new Error('DATABASE_URL is required.');const prisma=new PrismaClient({adapter:new PrismaPg({connectionString})});try{const result=await seedCatalog(prisma);console.log(`Catalog: ${result.count} stable global exercises, ${result.inserted} newly inserted, ${result.aliases} aliases.`);}finally{await prisma.$disconnect();}}
main().catch(()=>{console.error('Exercise catalog seed failed. Inspect migrations and catalog constraints; connection secrets are not logged.');process.exitCode=1;});
