import * as SQLite from "../sqlite"
import { DateTime, pipe, Struct } from "effect"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Database, type DatabaseError } from "./database"

export interface RepositoryOptions<Col extends string, Name extends string> {
	idColumn: Col
	name: Name
}

export type PartialExcept<T, K extends keyof T> = Partial<Omit<T, K>> & Pick<T, K>

export class EntityNotFound extends Schema.TaggedError<EntityNotFound>()("EntityNotFound", {
	type: Schema.String,
	id: Schema.Any,
}) {}

export interface RepositorySchemas<InsertSchema extends Schema.Top, UpdateSchema extends Schema.Struct<any>> {
	readonly insert: InsertSchema
	readonly update: UpdateSchema
}

/** Any table the repository can serve. */
export type AnyTable = SQLite.Table<string, any, any, any>

export interface Repository<
	RecordType,
	InsertType,
	UpdateType,
	Col extends keyof UpdateType & string,
	_Name extends string,
	Id,
> {
	readonly insert: (insert: InsertType) => Effect.Effect<RecordType[], DatabaseError | Schema.SchemaError>

	readonly insertVoid: (insert: InsertType) => Effect.Effect<void, DatabaseError | Schema.SchemaError>

	readonly update: (
		update: PartialExcept<UpdateType, Col>,
	) => Effect.Effect<RecordType, DatabaseError | Schema.SchemaError>

	readonly updateVoid: (
		update: PartialExcept<UpdateType, Col>,
	) => Effect.Effect<void, DatabaseError | Schema.SchemaError>

	readonly findById: (id: Id) => Effect.Effect<Option.Option<RecordType>, DatabaseError>

	readonly with: <A, E, R>(
		id: Id,
		f: (item: RecordType) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | EntityNotFound | DatabaseError, R>

	readonly deleteById: (id: Id) => Effect.Effect<void, DatabaseError>
}

/**
 * The validated domain input as a row of `table`: keys the table has no column for are dropped
 * (domain insert schemas carry extras such as a message's `attachmentIds`), `undefined` leaves the
 * column to its default, and a `DateTime` becomes the `Date` the timestamp columns take.
 */
export const toRow = (table: AnyTable, input: Record<string, unknown>): Record<string, unknown> => {
	const row: Record<string, unknown> = {}
	for (const key of Object.keys(table.columns)) {
		const value = input[key]
		if (value === undefined) continue
		row[key] = DateTime.isDateTime(value) ? DateTime.toDate(value) : value
	}
	return row
}

export function makeRepository<
	T extends AnyTable,
	InsertSchema extends Schema.Top,
	UpdateSchema extends Schema.Struct<any>,
	Col extends keyof SQLite.SelectRowOf<T> & keyof UpdateSchema["Type"] & string,
	Name extends string,
	RecordType extends SQLite.SelectRowOf<T>,
	Id extends SQLite.SelectRowOf<T>[Col],
>(
	table: T,
	schemas: RepositorySchemas<InsertSchema, UpdateSchema>,
	options: RepositoryOptions<Col, Name>,
): Effect.Effect<
	Repository<RecordType, InsertSchema["Type"], UpdateSchema["Type"], Col, Name, Id>,
	never,
	Database
> {
	return Effect.gen(function* () {
		const db = yield* Database
		const { idColumn } = options
		const updateSchema = schemas.update.mapFields(Struct.map(Schema.optional))
		// The id column, typed loosely: the repository is generic over every table.
		const byId = ($: any, id: unknown) => [$[idColumn].eq(id)]
		const anyTable = table as any

		const decodeInsert = (data: unknown) =>
			Schema.decodeUnknownEffect(schemas.insert as Schema.Top)(data) as Effect.Effect<
				Record<string, unknown>,
				Schema.SchemaError
			>
		const decodeUpdate = (data: unknown) =>
			Schema.decodeUnknownEffect(updateSchema as Schema.Top)(data) as Effect.Effect<
				Record<string, unknown>,
				Schema.SchemaError
			>

		const insert = (data: InsertSchema["Type"]) =>
			decodeInsert(data).pipe(
				Effect.flatMap((input) =>
					db.run(SQLite.insertInto(anyTable).values(toRow(table, input)).returning() as any),
				),
				Effect.withSpan(`${options.name}.insert`),
			) as unknown as Effect.Effect<RecordType[], DatabaseError | Schema.SchemaError>

		const insertVoid = (data: InsertSchema["Type"]) =>
			decodeInsert(data).pipe(
				Effect.flatMap((input) =>
					db.run(SQLite.insertInto(anyTable).values(toRow(table, input)) as any),
				),
				Effect.asVoid,
				Effect.withSpan(`${options.name}.insertVoid`),
			)

		const updateRows = (data: PartialExcept<UpdateSchema["Type"], Col>) =>
			decodeUpdate(data).pipe(
				Effect.flatMap((input) => {
					const { [idColumn]: id, ...rest } = toRow(table, input)
					const set = Object.keys(rest).length > 0 ? rest : { [idColumn]: id }
					return db.run(
						SQLite.update(anyTable)
							.set(set as any)
							.where(($: any) => byId($, input[idColumn]))
							.returning() as any,
					)
				}),
			) as unknown as Effect.Effect<RecordType[], DatabaseError | Schema.SchemaError>

		const update = (data: PartialExcept<UpdateSchema["Type"], Col>) =>
			updateRows(data).pipe(
				Effect.flatMap((rows) =>
					rows.length > 0
						? Effect.succeed(rows[0] as RecordType)
						: Effect.die(
								new EntityNotFound({
									type: options.name,
									id: (data as Record<string, unknown>)[idColumn],
								}),
							),
				),
				Effect.withSpan(`${options.name}.update`),
			)

		const updateVoid = (data: PartialExcept<UpdateSchema["Type"], Col>) =>
			updateRows(data).pipe(Effect.asVoid, Effect.withSpan(`${options.name}.updateVoid`))

		const findById = (id: Id) =>
			db
				.first(
					SQLite.from(anyTable)
						.select()
						.where(($: any) => byId($, id))
						.limit(1) as any,
				)
				.pipe(Effect.withSpan(`${options.name}.findById`)) as Effect.Effect<
				Option.Option<RecordType>,
				DatabaseError
			>

		const deleteById = (id: Id) =>
			db
				.run(SQLite.deleteFrom(anyTable).where(($: any) => byId($, id)) as any)
				.pipe(Effect.asVoid, Effect.withSpan(`${options.name}.deleteById`))

		const with_ = <A, E, R>(
			id: Id,
			f: (item: RecordType) => Effect.Effect<A, E, R>,
		): Effect.Effect<A, E | EntityNotFound | DatabaseError, R> =>
			pipe(
				findById(id),
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.fail(new EntityNotFound({ type: options.name, id })),
						onSome: Effect.succeed,
					}),
				),
				Effect.flatMap(f),
			)

		return {
			insert,
			insertVoid,
			update,
			updateVoid,
			findById,
			deleteById,
			with: with_,
		}
	})
}
