/**
 * The closed option sets a view chooses from (`docs/hazel-ui.md`, "Design language"; contract C1).
 * Style sets come from the style layer's lists (`src/style/schema.ts`), which the recipes key on.
 * Changes are design decisions the user reviews (`packages/ui/CONTRACTS.md`).
 */
import { Schema } from "effect"
import * as Sets from "../style/schema.ts"

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

export const StackAxis = Schema.Literals(Sets.stackAxes)
export type StackAxis = typeof StackAxis.Type

export const StackDensity = Schema.Literals(Sets.stackDensities)
export type StackDensity = typeof StackDensity.Type

export const StackAlign = Schema.Literals(Sets.stackAligns)
export type StackAlign = typeof StackAlign.Type

export const FrameSurface = Schema.Literals(Sets.frameSurfaces)
export type FrameSurface = typeof FrameSurface.Type

export const HeadingLevel = Schema.Literals(Sets.headingLevels)
export type HeadingLevel = typeof HeadingLevel.Type

export const AvatarPresence = Schema.Literals(Sets.avatarPresences)
export type AvatarPresence = typeof AvatarPresence.Type

export const AvatarSize = Schema.Literals(Sets.avatarSizes)
export type AvatarSize = typeof AvatarSize.Type

export const ProviderMark = Schema.Literals(Sets.providerMarks)
export type ProviderMark = typeof ProviderMark.Type

/** A provider in data (`row.provider`): a mark without `none`. */
export const Provider = Schema.Literals(["slack", "discord"])
export type Provider = typeof Provider.Type

export const ItemNesting = Schema.Literals(Sets.itemNestings)
export type ItemNesting = typeof ItemNesting.Type

export const EmptyIllustration = Schema.Literals(Sets.emptyIllustrations)
export type EmptyIllustration = typeof EmptyIllustration.Type

/** Keys the composer reports while a trigger's suggestions are open (`autocomplete-keys`). */
export const ComposerKey = Schema.Literals(["up", "down", "enter", "tab", "escape"])
export type ComposerKey = typeof ComposerKey.Type

export const ListDividerKind = Schema.Literals(Sets.listDividerKinds)
export type ListDividerKind = typeof ListDividerKind.Type

export const ListAnchor = Schema.Literals(Sets.listAnchors)
export type ListAnchor = typeof ListAnchor.Type

/**
 * Icon names both hosts draw, each the web's own icon (`web-foldkit/src/icons`, `iconSources`). C1 adds
 * what the four phase 1 screens draw; the iOS asset catalog exports the same list.
 */
export const iconNames = [
	"arrow-up",
	"bell",
	"check",
	"chevron-down",
	"chevron-right",
	"close",
	"copy",
	"discord",
	"dots",
	"download",
	"edit",
	"emoji",
	"emoji-add",
	"gear",
	"gif",
	"hashtag",
	"leave",
	"lightbulb",
	"lock",
	"office",
	"paperclip",
	"pin",
	"plus",
	"reply",
	"search",
	"share",
	"slack",
	"sparkles",
	"star",
	"thread",
	"trash",
	"users",
	"volume-mute",
	"warning",
] as const
export const IconName = Schema.Literals(iconNames)
export type IconName = typeof IconName.Type

/** Each name's web icon export (`apps/web-foldkit/src/icons`). */
export const iconSources = {
	"arrow-up": "IconArrowUp",
	bell: "IconBell",
	check: "IconCheck",
	"chevron-down": "IconChevronDown",
	"chevron-right": "IconChevronRight",
	close: "IconClose",
	copy: "IconCopy",
	discord: "IconDiscord",
	dots: "IconDots",
	download: "IconDownload",
	edit: "IconEdit",
	emoji: "IconEmoji1",
	"emoji-add": "IconEmojiAdd",
	gear: "IconGear",
	gif: "IconGif",
	hashtag: "IconHashtag",
	leave: "IconLeave",
	lightbulb: "IconLightbulb",
	lock: "IconLock",
	office: "IconOffice",
	paperclip: "IconPaperclip2",
	pin: "IconPin",
	plus: "IconPlus",
	reply: "IconReply",
	search: "IconMagnifier3",
	share: "IconShare",
	slack: "IconSlack",
	sparkles: "IconSparkles",
	star: "IconStar",
	thread: "IconThread",
	trash: "IconTrash",
	users: "IconUsers",
	"volume-mute": "IconVolumeMute",
	warning: "IconWarning",
} as const satisfies { readonly [K in IconName]: string }

/** What a message row offers on hover (web toolbar) or long press (iOS menu); `action` reports one. */
export const MessageAction = Schema.Literals([
	"react",
	"reply",
	"thread",
	"copy",
	"edit",
	"pin",
	"unpin",
	"issue",
	"delete",
])
export type MessageAction = typeof MessageAction.Type

/** Colour token names an extension may take (G1 stand-in; lane D replaces it with `tokens.ts` names). */
export const TokenColor = Schema.Literals(["brand.500", "brand.300", "accent.400", "neutral.200"])
export type TokenColor = typeof TokenColor.Type

export const Platform = Schema.Literals(["web", "ios"])
export type Platform = typeof Platform.Type
