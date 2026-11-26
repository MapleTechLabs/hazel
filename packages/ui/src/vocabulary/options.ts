/**
 * The closed option sets a view chooses from (`docs/hazel-ui.md`, "Design language"). G1 carries only
 * the ones its tags use; phase 1 freezes the full sets.
 */
import { Schema } from "effect"

export const TextRole = Schema.Literals(["body", "label", "caption", "title", "display", "code"])
export type TextRole = typeof TextRole.Type

export const TextTone = Schema.Literals([
	"default",
	"muted",
	"subtle",
	"accent",
	"success",
	"warning",
	"danger",
	"info",
])
export type TextTone = typeof TextTone.Type

/** Icon names both hosts draw: the web's own SVGs, the iOS asset catalog (`scripts/export-icons.ts`). */
export const IconName = Schema.Literals(["hashtag", "lock", "plus", "chevron-down", "sparkles"])
export type IconName = typeof IconName.Type

/** Colour token names an extension may take (G1 stand-in until `src/style/tokens.ts` lands). */
export const TokenColor = Schema.Literals(["brand.500", "brand.300", "accent.400", "neutral.200"])
export type TokenColor = typeof TokenColor.Type

export const Platform = Schema.Literals(["web", "ios"])
export type Platform = typeof Platform.Type
