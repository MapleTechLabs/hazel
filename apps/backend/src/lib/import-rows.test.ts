import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { canonicalRow, type ImportTable } from "./import-rows"

const table: ImportTable = {
	name: "things",
	columns: {
		id: { schema: Schema.String },
		note: { schema: Schema.NullOr(Schema.String) },
	},
	defaults: ["note"],
}

describe("canonicalRow", () => {
	it("keeps a source NULL in a defaulted column", () =>
		Effect.runPromise(
			canonicalRow(table, { id: "a", note: null }).pipe(
				Effect.map((row) => expect(row).toEqual({ id: "a", note: null })),
			),
		))

	it("leaves out a defaulted column the row omits, so the insert uses its default", () =>
		Effect.runPromise(
			canonicalRow(table, { id: "a" }).pipe(Effect.map((row) => expect(row).toEqual({ id: "a" }))),
		))
})
