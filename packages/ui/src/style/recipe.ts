import type { Recipe } from "./schema.ts"
import type { HazelTokenNames } from "./tokens.ts"

/** Types a recipe against Hazel's token names; one file per primitive in `./recipes/`. */
export const defineRecipe = <
	const Options extends Readonly<Record<string, string>>,
	Flags extends string = never,
	Part extends string = never,
>(
	recipe: Recipe<Options, Flags, Part, HazelTokenNames>,
): Recipe<Options, Flags, Part, HazelTokenNames> => recipe
