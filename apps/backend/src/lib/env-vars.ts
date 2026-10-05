import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"

export class EnvVars extends Context.Service<EnvVars>()("EnvVars", {
	make: Effect.gen(function* () {
		return {
			IS_DEV: yield* Config.Boolean("IS_DEV").pipe(Config.withDefault(false)),
			DATABASE_URL: yield* Config.Redacted("DATABASE_URL"),
		} as const
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
