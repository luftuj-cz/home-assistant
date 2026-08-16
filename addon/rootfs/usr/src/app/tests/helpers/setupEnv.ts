import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Points the database path at a throwaway directory before any test module is
 * imported.
 *
 * `DATABASE_PATH` in `services/database.ts` is resolved once, at import time.
 * A test file that imports the module before setting `LUFTATOR_DB_PATH` - as
 * the migration tests do - therefore captures the real add-on data directory,
 * and anything writing beside the database file (the pre-migration backup)
 * lands next to the developer's live database and copies it.
 *
 * `setupTempDatabase` still overrides this per test; this only makes the
 * default harmless.
 */
process.env.LUFTATOR_DB_PATH ??= path.join(
  mkdtempSync(path.join(tmpdir(), "luftator-test-default-")),
  "luftator.db",
);
