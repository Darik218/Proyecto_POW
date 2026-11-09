import pg from 'pg';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { sep } from 'node:path';

export async function progressionIsolation() {
  const url = process.env.PROG1B_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error('Disposable progression runner required.');
  const parsed = new URL(url);
  const directory = process.env.PROG1B_TEST_DATA_DIRECTORY;
  if (
    parsed.hostname !== '127.0.0.1' ||
    parsed.pathname !== '/pulso_prog1b_test' ||
    parsed.port !== process.env.PROG1B_TEST_PORT ||
    !directory ||
    !(await realpath(directory)).startsWith(
      (await realpath(tmpdir())) + sep + 'pulso-prog1b-',
    )
  )
    throw new Error('Unsafe progression target.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT current_database() AS name, current_setting('data_directory') AS directory, inet_server_port() AS port",
    );
    if (
      rows[0].name !== 'pulso_prog1b_test' ||
      String(rows[0].port) !== parsed.port ||
      (await realpath(rows[0].directory)) !== (await realpath(directory))
    )
      throw new Error('Wrong progression cluster.');
  } finally {
    await client.end();
  }
  return url;
}
