import type { TagKey } from "../vocabulary/spec.ts"
import type { Recipe } from "./schema.ts"
import type { HazelTokenNames } from "./tokens.ts"

/**
 * Types a recipe against Hazel's token names (contract C3). One file per primitive,
 * `recipes/<tag>.ts`, exporting exactly one recipe whose `primitive` is that tag's key in
 * `vocabulary/spec.ts`; the lane that owns the primitive writes it, lane D reviews it.
 * A message's own states (`pinned`, `grouped`...) are recipe `flags`, as `data-<flag>` on the web.
 */
export const defineRecipe = <
	const Options extends Readonly<Record<string, string>>,
	Flags extends string = never,
	Part extends string = never,
>(
	recipe: Recipe<Options, Flags, Part, HazelTokenNames> & { readonly primitive: TagKey },
): Recipe<Options, Flags, Part, HazelTokenNames> => recipe
