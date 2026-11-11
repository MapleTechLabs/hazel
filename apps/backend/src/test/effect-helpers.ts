import type { Context } from "effect"

export const serviceShape = <T extends Context.Service.Any>(shape: unknown) =>
	shape as Context.Service.Shape<T>
