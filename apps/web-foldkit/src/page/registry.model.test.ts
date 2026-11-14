// @vitest-environment jsdom
import { Schema } from "effect"
import { expect, test } from "vitest"
import { Model } from "../app/model"
import { boot } from "../test/root-fixtures"

// The dev server keeps the Model across a reload as JSON. A page of a lazy area is in the Model's
// schema only once its area has loaded, which the dev server does before the app starts.
test("a Model on a lazy area's page encodes to JSON and back", () => {
	const model = boot("/hazel/customers")
	expect(model.page?._tag).toBe("CustomersOverview")
	// SAFETY: the Model needs no services to encode; page schemas only type theirs as unknown.
	const codec = Schema.toCodecJson(Model) as unknown as Schema.Codec<Model, unknown>
	const kept: unknown = JSON.parse(JSON.stringify(Schema.encodeUnknownSync(codec)(model)))
	expect(Schema.decodeUnknownSync(codec)(kept).page).toEqual(model.page)
})
