import { sql } from "drizzle-orm";
import { afterEach } from "vitest";

import { db } from "#lib/server/db/index.ts";

afterEach(() => {
  // Full-text indexes keep their data in shadow tables, which only the index
  // itself may change.
  const tables = db.all<{ name: string }>(
    sql`select name from pragma_table_list
         where schema = 'main'
           and type in ('table', 'virtual')
           and name not like 'sqlite_%'
           and name not like '__drizzle%'`,
  );
  db.run(sql`pragma foreign_keys = off`);
  for (const { name } of tables) db.run(sql.raw(`delete from "${name}"`));
  db.run(sql`pragma foreign_keys = on`);
});
