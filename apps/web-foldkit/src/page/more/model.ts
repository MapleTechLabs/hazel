import { Schema } from "effect"

/** The More tab holds no state of its own: it reads the user and workspace from `Shared`. */
export const Model = Schema.Struct({})
export type Model = typeof Model.Type
