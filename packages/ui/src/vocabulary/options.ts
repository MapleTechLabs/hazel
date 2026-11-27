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

export const ScreenSurface = Schema.Literals(Sets.screenSurfaces)
export type ScreenSurface = typeof ScreenSurface.Type

export const SectionStyle = Schema.Literals(Sets.sectionStyles)
export type SectionStyle = typeof SectionStyle.Type

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

export const AvatarStackLayout = Schema.Literals(Sets.avatarStackLayouts)
export type AvatarStackLayout = typeof AvatarStackLayout.Type

export const IconTileTone = Schema.Literals(Sets.iconTileTones)
export type IconTileTone = typeof IconTileTone.Type

export const ItemUnreadMark = Schema.Literals(Sets.itemUnreadMarks)
export type ItemUnreadMark = typeof ItemUnreadMark.Type

export const LineCount = Schema.Literals(Sets.lineCounts)
export type LineCount = typeof LineCount.Type

export const ItemLeadingSize = Schema.Literals(Sets.itemLeadingSizes)
export type ItemLeadingSize = typeof ItemLeadingSize.Type

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

// Phase 4 (`docs/hazel-ui-phase4.md`): the web pages' sets.

export const GridColumns = Schema.Literals(Sets.gridColumns)
export type GridColumns = typeof GridColumns.Type

export const ChoiceStyle = Schema.Literals(Sets.choiceStyles)
export type ChoiceStyle = typeof ChoiceStyle.Type

/** How many option cards share a row in `choiceGroup` style `cards` (one on the compact size class). */
export const ChoiceColumns = Schema.Literals(["1", "2", "3"])
export type ChoiceColumns = typeof ChoiceColumns.Type

export const ToggleStyle = Schema.Literals(Sets.toggleStyles)
export type ToggleStyle = typeof ToggleStyle.Type

export const ProgressStyle = Schema.Literals(Sets.progressStyles)
export type ProgressStyle = typeof ProgressStyle.Type

export const BannerStyle = Schema.Literals(Sets.bannerStyles)
export type BannerStyle = typeof BannerStyle.Type

export const TabBarStyle = Schema.Literals(Sets.tabBarStyles)
export type TabBarStyle = typeof TabBarStyle.Type

export const ChartKind = Schema.Literals(Sets.chartKinds)
export type ChartKind = typeof ChartKind.Type

export const ChartSize = Schema.Literals(Sets.chartSizes)
export type ChartSize = typeof ChartSize.Type

/** How a chart prints its values (axis, tooltip, end labels); `currency` uses the chart's `currency`. */
export const ChartFormat = Schema.Literals(["number", "currency", "percent", "duration"])
export type ChartFormat = typeof ChartFormat.Type

export const StatTrend = Schema.Literals(Sets.statTrends)
export type StatTrend = typeof StatTrend.Type

export const StatDeltaTone = Schema.Literals(Sets.statDeltaTones)
export type StatDeltaTone = typeof StatDeltaTone.Type

export const AttachmentLayout = Schema.Literals(Sets.attachmentLayouts)
export type AttachmentLayout = typeof AttachmentLayout.Type

/**
 * A file's type for its coloured icon (`p4-file-type-icons`, today's `chat/file-icons.ts`, keyed as
 * `getFileTypeFromName` returns); `empty` is the blank page a type without its own icon draws.
 */
export const AttachmentFileType = Schema.Literals([
	"empty",
	"csv",
	"doc",
	"docx",
	"gif",
	"jpg",
	"mp3",
	"mp4",
	"pdf",
	"png",
	"svg",
	"txt",
	"wav",
	"webp",
	"xls",
	"xlsx",
])
export type AttachmentFileType = typeof AttachmentFileType.Type

/** What a text field holds, for the keyboard and validation hints; a password is `secret`. */
export const InputKind = Schema.Literals(["text", "email", "url", "number"])
export type InputKind = typeof InputKind.Type

/** What a date picker picks: a day, a time of day (`HH:mm`), or both. */
export const DateGranularity = Schema.Literals(["date", "time", "dateTime"])
export type DateGranularity = typeof DateGranularity.Type

/** What opens a popover: a press on its anchor, or hovering it for a moment (a hover card). */
export const PopoverTrigger = Schema.Literals(["press", "hover"])
export type PopoverTrigger = typeof PopoverTrigger.Type

export const SheetStyle = Schema.Literals(Sets.sheetStyles)
export type SheetStyle = typeof SheetStyle.Type

export const DialogSize = Schema.Literals(Sets.dialogSizes)
export type DialogSize = typeof DialogSize.Type

export const DialogIconTone = Schema.Literals(Sets.dialogIconTones)
export type DialogIconTone = typeof DialogIconTone.Type

/**
 * Icon names both hosts draw, each the web's own icon (`web-foldkit/src/icons`, `iconSources`). C1 added
 * what the phase 1 screens draw; phase 4 adds every other web icon, so the web pages need no icon of
 * their own. The iOS asset catalog exports the same list (lane S1 re-runs `export-icons.ts`).
 */
export const iconNames = [
	"apps",
	"arrow-left",
	"arrow-up",
	"bell",
	"bell-off",
	"brain",
	"chart",
	"chat",
	"check",
	"chevron-down",
	"chevron-left",
	"chevron-right",
	"chevron-up-down",
	"clock",
	"close",
	"code",
	"connect",
	"copy",
	"cube",
	"dashboard",
	"discord",
	"dots",
	"dots-vertical",
	"download",
	"edit",
	"emoji",
	"emoji-add",
	"envelope",
	"external-link",
	"eye",
	"eye-off",
	"folder-plus",
	"folders",
	"gear",
	"gif",
	"github",
	"google",
	"hashtag",
	"heart",
	"image",
	"integration",
	"keyboard",
	"leave",
	"lightbulb",
	"link",
	"loader",
	"lock",
	"logout",
	"map-pin",
	"maximize",
	"megaphone",
	"menu",
	"message-pen",
	"message-user",
	"messages",
	"minus",
	"moon",
	"office",
	"paintbrush",
	"paperclip",
	"pause",
	"pen-sparkle",
	"phone",
	"pin",
	"play",
	"plus",
	"plus-circle",
	"presentation",
	"profiles",
	"refresh",
	"reply",
	"robot",
	"rocket",
	"search",
	"servers",
	"share",
	"shop",
	"sidebar-right",
	"slack",
	"sparkles",
	"star",
	"sun",
	"support",
	"thread",
	"trash",
	"unpin",
	"user",
	"user-pending",
	"user-plus",
	"users",
	"volume",
	"volume-mute",
	"warning",
	"webhook",
] as const
export const IconName = Schema.Literals(iconNames)
export type IconName = typeof IconName.Type

/** Each name's web icon export (`apps/web-foldkit/src/icons`). */
export const iconSources = {
	apps: "IconGridCirclePlus",
	"arrow-left": "IconArrowLeft",
	"arrow-up": "IconArrowUp",
	bell: "IconBell",
	"bell-off": "IconBellSlash",
	brain: "IconBrainSparkle",
	chart: "IconChartBar",
	chat: "IconChatBubble",
	check: "IconCheck",
	"chevron-down": "IconChevronDown",
	"chevron-left": "IconChevronLeft",
	"chevron-right": "IconChevronRight",
	"chevron-up-down": "IconChevronUpDown",
	clock: "IconClock",
	close: "IconClose",
	code: "IconCode",
	connect: "IconConnect",
	copy: "IconCopy",
	cube: "IconCube",
	dashboard: "IconDashboard",
	discord: "IconDiscord",
	dots: "IconDots",
	"dots-vertical": "IconDotsVertical",
	download: "IconDownload",
	edit: "IconEdit",
	emoji: "IconEmoji1",
	"emoji-add": "IconEmojiAdd",
	envelope: "IconEnvelope",
	"external-link": "IconExternalLink",
	eye: "IconEye",
	"eye-off": "IconEyeSlash",
	"folder-plus": "IconFolderPlus",
	folders: "IconFolders",
	gear: "IconGear",
	gif: "IconGif",
	github: "IconGitHub",
	google: "IconGoogle",
	hashtag: "IconHashtag",
	heart: "IconHeart",
	image: "IconImage",
	integration: "IconIntegratio",
	keyboard: "IconKeyboard",
	leave: "IconLeave",
	lightbulb: "IconLightbulb",
	link: "IconLink",
	loader: "IconLoader",
	lock: "IconLock",
	logout: "IconLogout",
	"map-pin": "IconMapPin",
	maximize: "IconMaximize",
	megaphone: "IconMegaphone",
	menu: "IconMenu",
	"message-pen": "IconMsgPen",
	"message-user": "IconMsgUser",
	messages: "IconMsgs",
	minus: "IconMinus",
	moon: "IconMoon",
	office: "IconOffice",
	paintbrush: "IconPaintbrush",
	paperclip: "IconPaperclip2",
	pause: "IconCirclePause",
	"pen-sparkle": "IconPenSparkle",
	phone: "IconPhone",
	pin: "IconPin",
	play: "IconPlay",
	plus: "IconPlus",
	"plus-circle": "IconCirclePlus",
	presentation: "IconPresentationChart",
	profiles: "IconProfiles2",
	refresh: "IconArrowPath",
	reply: "IconReply",
	robot: "IconRobot",
	rocket: "IconRocket",
	search: "IconMagnifier3",
	servers: "IconServers",
	share: "IconShare",
	shop: "IconShop",
	"sidebar-right": "IconSidebarRight",
	slack: "IconSlack",
	sparkles: "IconSparkles",
	star: "IconStar",
	sun: "IconSun",
	support: "IconSupport",
	thread: "IconThread",
	trash: "IconTrash",
	unpin: "IconUnpin",
	user: "IconUser",
	"user-pending": "IconCircleDottedUser",
	"user-plus": "IconUsersPlus",
	users: "IconUsers",
	volume: "IconVolume",
	"volume-mute": "IconVolumeMute",
	warning: "IconWarning",
	webhook: "IconWebhook",
} as const satisfies { readonly [K in IconName]: string }

/**
 * What a message row offers on hover (web toolbar) or long press (iOS menu); `action` reports one.
 * `selectText` is handled by the host first (iOS starts native selection on the row; the web never
 * lists it, its text is selectable already), then reported (`message-select-text`).
 */
export const MessageAction = Schema.Literals([
	"react",
	"reply",
	"thread",
	"copy",
	"edit",
	"pin",
	"unpin",
	"issue",
	"selectText",
	"delete",
	// Phase 4 (`p4-message-menu-extras`): the web's right-click menu over an image, and the id.
	"copyImage",
	"copyImageUrl",
	"copyId",
])
export type MessageAction = typeof MessageAction.Type

/** Colour token names an extension may take (G1 stand-in; lane D replaces it with `tokens.ts` names). */
export const TokenColor = Schema.Literals(["brand.500", "brand.300", "accent.400", "neutral.200"])
export type TokenColor = typeof TokenColor.Type

export const Platform = Schema.Literals(["web", "ios"])
export type Platform = typeof Platform.Type
