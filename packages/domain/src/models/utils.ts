import * as VariantSchema from "effect/schema/VariantSchema"
import * as Schema from "effect/Schema"
import * as Struct_ from "effect/Struct"

const { Class, Field, Struct } = VariantSchema.make({
	variants: ["select", "insert", "update", "json", "jsonCreate", "jsonUpdate"],
	defaultVariant: "select",
})

export type Any = Schema.Top & {
	readonly fields: Schema.Struct.Fields
	readonly insert: Schema.Top
	readonly update: Schema.Top
	readonly json: Schema.Top
	readonly jsonCreate: Schema.Top
	readonly jsonUpdate: Schema.Top
}

export {
	/**
	 * A base class for creating domain model schemas with variants for database and JSON APIs.
	 *
	 * @example
	 * ```ts
	 * export class Group extends Model.Class<Group>("Group")({
	 *   id: Model.Generated(GroupId),
	 *   name: Schema.NonEmptyTrimmedString,
	 *   ...Model.baseFields,
	 * }) {}
	 *
	 * Group.insert        // for inserts
	 * Group.update        // for updates
	 * Group.json          // for JSON API
	 * Group.jsonCreate    // for JSON creation
	 * Group.jsonUpdate    // for JSON updates
	 * ```
	 */
	Class,
	Field,
	Struct,
}

export const fields: <A extends VariantSchema.Struct<any>>(self: A) => A[typeof VariantSchema.TypeId] =
	VariantSchema.fields

export const structFields = <A extends { readonly fields: Schema.Struct.Fields }>(self: A): A["fields"] =>
	self.fields

export interface Generated<S extends Schema.Top> extends VariantSchema.Field<{
	readonly select: S
	readonly update: S
	readonly json: S
}> {}

/** A field for database-generated columns (available for select and update, not insert). */
export const Generated = <S extends Schema.Top>(schema: S): Generated<S> =>
	Field({
		select: schema,
		update: schema,
		json: schema,
	})

export interface GeneratedOptional<S extends Schema.Top> extends VariantSchema.Field<{
	readonly select: S
	readonly insert: Schema.optionalKey<S>
	readonly update: S
	readonly json: S
	readonly jsonCreate: Schema.optionalKey<S>
}> {}

/**
 * A field for database-generated columns that can optionally be overridden on insert.
 * Useful for supporting optimistic updates where the client generates the ID upfront.
 * - Required for select, update, and json
 * - Optional for insert and jsonCreate (if not provided, DB generates the value)
 */
export const GeneratedOptional = <S extends Schema.Top>(schema: S): GeneratedOptional<S> =>
	Field({
		select: schema,
		insert: Schema.optionalKey(schema),
		update: schema,
		json: schema,
		jsonCreate: Schema.optionalKey(schema),
	})

export interface GeneratedByApp<S extends Schema.Top> extends VariantSchema.Field<{
	readonly select: S
	readonly insert: S
	readonly update: S
	readonly json: S
}> {}

/** A field for application-generated columns (required for DB variants, optional for JSON). */
export const GeneratedByApp = <S extends Schema.Top>(schema: S): GeneratedByApp<S> =>
	Field({
		select: schema,
		insert: schema,
		update: schema,
		json: schema,
	})

export interface Defaulted<S extends Schema.Top> extends VariantSchema.Field<{
	readonly select: S
	readonly insert: Schema.optionalKey<S>
	readonly update: S
	readonly json: S
	readonly jsonCreate: Schema.optionalKey<S>
	readonly jsonUpdate: S
}> {}

/** A column with a database default: optional on insert and create, otherwise a plain field. */
export const Defaulted = <S extends Schema.Top>(schema: S): Defaulted<S> =>
	Field({
		select: schema,
		insert: Schema.optionalKey(schema),
		update: schema,
		json: schema,
		jsonCreate: Schema.optionalKey(schema),
		jsonUpdate: schema,
	})

export interface Immutable<S extends Schema.Top> extends VariantSchema.Field<{
	readonly select: S
	readonly insert: S
	readonly update: S
	readonly json: S
	readonly jsonCreate: S
}> {}

/** A field that is immutable after creation — present in all variants except jsonUpdate. */
export const Immutable = <S extends Schema.Top>(schema: S): Immutable<S> =>
	Field({
		select: schema,
		insert: schema,
		update: schema,
		json: schema,
		jsonCreate: schema,
	})

export interface Sensitive<S extends Schema.Top> extends VariantSchema.Field<{
	readonly select: S
	readonly insert: S
	readonly update: S
}> {}

/** A field for sensitive values hidden from JSON variants. */
export const Sensitive = <S extends Schema.Top>(schema: S): Sensitive<S> =>
	Field({
		select: schema,
		insert: schema,
		update: schema,
	})

/** Maps a Struct's fields to optionalKey — for partial update payloads. */
type PartialStruct<S extends Schema.Top> =
	S extends Schema.Struct<infer F>
		? Schema.Struct<{ readonly [K in keyof F]: Schema.optionalKey<F[K] & Schema.Top> }>
		: never

export interface ExposedModel<
	InsertSchema extends Schema.Top,
	UpdateSchema extends Schema.Top,
	JsonSchema extends Schema.Top,
	CreateSchema extends Schema.Top,
	PatchSchema extends Schema.Top,
> {
	readonly Insert: InsertSchema
	readonly Update: UpdateSchema
	readonly Schema: JsonSchema
	readonly Create: CreateSchema
	readonly Patch: PatchSchema
	readonly PatchPartial: PartialStruct<PatchSchema>
}

export interface ExposedModelWithRow<
	RowSchema extends Any,
	InsertSchema extends Schema.Top,
	UpdateSchema extends Schema.Top,
	JsonSchema extends Schema.Top,
	CreateSchema extends Schema.Top,
	PatchSchema extends Schema.Top,
> extends ExposedModel<InsertSchema, UpdateSchema, JsonSchema, CreateSchema, PatchSchema> {
	readonly Row: RowSchema
}

export const expose = <
	Model extends Any,
	InsertSchema extends Schema.Top = Model["insert"],
	UpdateSchema extends Schema.Top = Model["update"],
	JsonSchema extends Schema.Top = Model["json"],
	CreateSchema extends Schema.Top = Model["jsonCreate"],
	PatchSchema extends Schema.Top = Model["jsonUpdate"],
>(
	model: Model,
	overrides: Partial<ExposedModel<InsertSchema, UpdateSchema, JsonSchema, CreateSchema, PatchSchema>> = {},
): ExposedModel<InsertSchema, UpdateSchema, JsonSchema, CreateSchema, PatchSchema> => {
	const patch = overrides.Patch ?? (model.jsonUpdate as unknown as PatchSchema)
	return {
		Insert: overrides.Insert ?? (model.insert as unknown as InsertSchema),
		Update: overrides.Update ?? (model.update as unknown as UpdateSchema),
		Schema: overrides.Schema ?? (model.json as unknown as JsonSchema),
		Create: overrides.Create ?? (model.jsonCreate as unknown as CreateSchema),
		Patch: patch,
		PatchPartial: (patch as unknown as Schema.Struct<any>).mapFields(
			Struct_.map(Schema.optionalKey),
		) as PartialStruct<PatchSchema>,
	}
}

export const exposeWithRow = <
	Model extends Any,
	InsertSchema extends Schema.Top = Model["insert"],
	UpdateSchema extends Schema.Top = Model["update"],
	JsonSchema extends Schema.Top = Model["json"],
	CreateSchema extends Schema.Top = Model["jsonCreate"],
	PatchSchema extends Schema.Top = Model["jsonUpdate"],
>(
	model: Model,
	overrides: Partial<
		ExposedModelWithRow<Model, InsertSchema, UpdateSchema, JsonSchema, CreateSchema, PatchSchema>
	> = {},
): ExposedModelWithRow<Model, InsertSchema, UpdateSchema, JsonSchema, CreateSchema, PatchSchema> => ({
	...expose(model, overrides),
	Row: overrides.Row ?? model,
})

// Helper utilities for common model fields
export const JsonDate = Schema.Union([Schema.DateTimeUtcFromString, Schema.Date]).pipe(
	Schema.annotate({
		jsonSchema: { type: "string", format: "date-time" },
	}),
)

export const baseFields = {
	createdAt: Generated(JsonDate),
	updatedAt: Generated(Schema.NullOr(JsonDate)),
	deletedAt: GeneratedByApp(Schema.NullOr(JsonDate)),
}
