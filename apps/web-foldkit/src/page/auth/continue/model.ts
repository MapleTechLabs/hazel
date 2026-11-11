import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { Provider } from "../../../auth/client"
import { AuthFailure } from "../../../auth/flows"

/** `Invalid`: `?provider=` is missing or not one the API offers. */
export const Model = defineTaggedUnion({
	Invalid: {},
	Redirecting: { provider: Schema.Literals(Provider) },
	Failed: { reason: AuthFailure },
})
export type Model = typeof Model.Type
