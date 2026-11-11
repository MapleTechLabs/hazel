// `Config` helpers for runtime Worker env schemas. Imports only `effect`; keep it out of the
// package index, which pulls in deploy-side deps.
import { Config, Option } from "effect"

/** Optional string; treats a blank/whitespace-only value as absent (`None`). */
export const optionalString = (key: string) =>
	Config.option(Config.String(key)).pipe(
		Config.map((opt) =>
			Option.flatMap(opt, (s) => (s.trim().length > 0 ? Option.some(s) : Option.none())),
		),
	)
