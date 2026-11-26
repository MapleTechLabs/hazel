/**
 * The closed option sets a view chooses from (`docs/hazel-ui.md`, "Design language"). G1 carries only
 * the ones its tags use; phase 1 freezes the full sets.
 */
import { Schema } from "effect"
import * as Sets from "../style/schema.ts"

// One source for each set: the style layer's lists (`src/style/schema.ts`), which the recipes key on.
export const TextRole = Schema.Literals(Sets.textRoles)
export type TextRole = typeof TextRole.Type

export const TextTone = Schema.Literals(Sets.textTones)
export type TextTone = typeof TextTone.Type

export const ButtonVariant = Schema.Literals(Sets.buttonVariants)
export type ButtonVariant = typeof ButtonVariant.Type

/** `iconOnly` makes a button square, `circle` makes it round. */
export const ButtonSize = Schema.Literals(Sets.buttonSizes)
export type ButtonSize = typeof ButtonSize.Type

export const BadgeTone = Schema.Literals(Sets.badgeTones)
export type BadgeTone = typeof BadgeTone.Type

/** Today's `muted` badge is `neutral` + `quiet`; `pill` rounds a badge fully. */
export const BadgeStyle = Schema.Literals(Sets.badgeStyles)
export type BadgeStyle = typeof BadgeStyle.Type

export const BadgeSize = Schema.Literals(Sets.badgeSizes)
export type BadgeSize = typeof BadgeSize.Type

/** Icon names both hosts draw: the web's own SVGs, the iOS asset catalog (`scripts/export-icons.ts`). */
export const IconName = Schema.Literals(["hashtag", "lock", "plus", "chevron-down", "sparkles"])
export type IconName = typeof IconName.Type

/** Colour token names an extension may take (G1 stand-in until `src/style/tokens.ts` lands). */
export const TokenColor = Schema.Literals(["brand.500", "brand.300", "accent.400", "neutral.200"])
export type TokenColor = typeof TokenColor.Type

export const Platform = Schema.Literals(["web", "ios"])
export type Platform = typeof Platform.Type
