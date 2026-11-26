import type { Recipe } from "../schema.ts"
import { button } from "./button.ts"
import { item } from "./item.ts"
import { section } from "./section.ts"

/** Every recipe, in emission order. Phase 1.5 replaces this list with a file glob (docs/hazel-ui.md). */
export const recipes: ReadonlyArray<Recipe> = [section, item, button] as ReadonlyArray<Recipe>
