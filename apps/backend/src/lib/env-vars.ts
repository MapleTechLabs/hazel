import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"

export class EnvVars extends Context.Service<EnvVars>()("EnvVars", {
	make: Effect.gen(function* () {
		return {
			IS_DEV: yield* Config.Boolean("IS_DEV").pipe(Config.withDefault(false)),
			/** The local SQLite file the Bun runtime keeps every store's tables in. */
			DATABASE_FILE: yield* Config.String("DATABASE_FILE").pipe(Config.withDefault("hazel.sqlite")),
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
