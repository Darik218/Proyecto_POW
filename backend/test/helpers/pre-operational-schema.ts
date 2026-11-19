import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../../src/database/prisma.service';
import { progressionIsolation } from './progression-isolation';

/** Historical fixtures use the actual predecessor schema, with every trigger enabled. */
export async function withPreOperationalSchema<T>(
  run: (db: PrismaService, migrate: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const url = await progressionIsolation(),
    admin = new pg.Client({ connectionString: url }),
    name = 'pulso_pre_operational_' + randomUUID().replaceAll('-', ''),
    target = new URL(url);
  target.pathname = '/' + name;
  const sql = new pg.Client({ connectionString: target.toString() }),
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: target.toString() }),
    });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    await sql.connect();
    const location = (
      await sql.query(
        "SELECT current_database() AS name,current_setting('data_directory') AS directory,inet_server_port() AS port",
      )
    ).rows[0];
    if (
      location.name !== name ||
      String(location.port) !== target.port ||
      (await realpath(location.directory)) !==
        (await realpath(process.env.PROG1B_TEST_DATA_DIRECTORY!))
    )
      throw Error('Wrong predecessor database/cluster');
    const dir = resolve('prisma/migrations'),
      migration = '20261112001000_operational_progression_mvp',
      previous = (await readdir(dir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name < migration)
        .map((d) => d.name)
        .sort();
    if (previous.length !== 18)
      throw Error('Expected exactly eighteen predecessor migrations');
    for (const item of previous)
      await sql.query(
        await readFile(resolve(dir, item, 'migration.sql'), 'utf8'),
      );
    return await run(client as unknown as PrismaService, async () => {
      await sql.query(
        await readFile(resolve(dir, migration, 'migration.sql'), 'utf8'),
      );
    });
  } finally {
    await client.$disconnect();
    await sql.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
}
