# @hazel/db

Hazel's tables, query builder and `Database` service, on SQLite: each Durable Object's storage
(`OrgObject`, `ChannelObject`, `UserObject`) and the directory D1 database. See
`infra/durable-object-sync-plan.md` §1 for which tables each store holds.

- `src/tables/*`: effect-orm `SQLite.table` definitions. Column and table names are the ones the
  client models (`@hazel/domain/models`) decode.
- `src/stores.ts`: `directoryTables`, `orgTables`, `channelTables`, `userTables`.
- `src/schema-ddl.ts`: `renderStoreSchema`, `storeMigrations` and `applyMigrations`.
- `src/services/database.ts`: `Database` (`run`, `first`, `query`, `execute`, `transaction`) with
  `layerSqlite` (over a provided SQLite `SqlClient`) and `layerD1` (no transactions).
- `src/node.ts` (`@hazel/db/node`): `layerFile` and `layerMemory`, node SQLite with every store's
  tables, for tests, scripts and local processes.

```ts
import { Database, SQLite, schema } from "@hazel/db"

const db = yield * Database.Database
const channel =
	yield *
	db.first(
		SQLite.from(schema.channelsTable)
			.select()
			.where(($) => [$.id.eq(channelId), $.deletedAt.isNull()]),
	)
```

## Schema changes

Edit `src/tables`, then run `bun run db:generate-sqlite --name <name>`. Each store's last schema is
committed in `snapshots/<store>.json`; the script diffs the tables against it (`src/migration-plan.ts`,
effect-orm's SQLite diff plus the extra indexes), appends `<NNNN>_<name>` to
`src/migrations.generated.ts`, rewrites the snapshot and, for the directory store, writes
`migrations/directory/<NNNN>_<name>/migration.sql` for Alchemy. With no change it writes nothing.
A drop or rename needs hints: `--hints <file.json>`. Committed migrations are never edited.
Objects apply theirs when they next activate. `schema-ddl.test.ts` fails while the tables differ from
a snapshot.

Partial and JSON-expression indexes, which effect-orm cannot declare yet, are in
`src/tables/extra-indexes.ts`.
