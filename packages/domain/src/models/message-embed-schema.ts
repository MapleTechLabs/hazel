import { HtmlRenderId } from "@hazel/schema"
import { Schema } from "effect"
import { HTML_RENDER_MAX_HEIGHT, HTML_RENDER_MAX_TITLE_LENGTH, HTML_RENDER_MIN_HEIGHT } from "../html-render"

// Embed author section
export const MessageEmbedAuthor = Schema.Struct({
	name: Schema.String.check(Schema.isMaxLength(256)),
	url: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
	iconUrl: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
})
export type MessageEmbedAuthor = Schema.Schema.Type<typeof MessageEmbedAuthor>

// Embed footer section
export const MessageEmbedFooter = Schema.Struct({
	text: Schema.String.check(Schema.isMaxLength(2048)),
	iconUrl: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
})
export type MessageEmbedFooter = Schema.Schema.Type<typeof MessageEmbedFooter>

// Badge intent for field styling
export const BadgeIntent = Schema.Literals([
	"primary",
	"secondary",
	"success",
	"info",
	"warning",
	"danger",
	"outline",
])
export type BadgeIntent = Schema.Schema.Type<typeof BadgeIntent>

// Field type for rendering mode
export const MessageEmbedFieldType = Schema.Literals(["text", "badge"])
export type MessageEmbedFieldType = Schema.Schema.Type<typeof MessageEmbedFieldType>

// Field options for type-specific settings
export const MessageEmbedFieldOptions = Schema.Struct({
	intent: Schema.optional(BadgeIntent),
})
export type MessageEmbedFieldOptions = Schema.Schema.Type<typeof MessageEmbedFieldOptions>

// Embed field (for key-value display)
export const MessageEmbedField = Schema.Struct({
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
	value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
	inline: Schema.optional(Schema.Boolean),
	type: Schema.optional(MessageEmbedFieldType),
	options: Schema.optional(MessageEmbedFieldOptions),
})
export type MessageEmbedField = Schema.Schema.Type<typeof MessageEmbedField>

// Embed badge (for status indicators)
export const MessageEmbedBadge = Schema.Struct({
	text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
	color: Schema.optional(
		Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 16777215 })),
	), // 0x000000 to 0xFFFFFF
})
export type MessageEmbedBadge = Schema.Schema.Type<typeof MessageEmbedBadge>

// Agent step for cached state (matches actor's AgentStep)
export const CachedAgentStep = Schema.Struct({
	id: Schema.String,
	type: Schema.Literals(["thinking", "tool_call", "tool_result", "text", "error"]),
	status: Schema.Literals(["pending", "active", "completed", "failed"]),
	content: Schema.optional(Schema.String),
	toolName: Schema.optional(Schema.String),
	toolInput: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
	toolOutput: Schema.optional(Schema.Unknown),
	toolError: Schema.optional(Schema.String),
	startedAt: Schema.optional(Schema.Number),
	completedAt: Schema.optional(Schema.Number),
})
export type CachedAgentStep = Schema.Schema.Type<typeof CachedAgentStep>

// Live state cached snapshot for non-realtime clients
export const MessageEmbedLiveStateCached = Schema.Struct({
	status: Schema.Literals(["idle", "active", "completed", "failed"]),
	data: Schema.Record(Schema.String, Schema.Unknown),
	text: Schema.optional(Schema.String),
	progress: Schema.optional(Schema.Number),
	error: Schema.optional(Schema.String),
	steps: Schema.optional(Schema.Array(CachedAgentStep)),
})
export type MessageEmbedLiveStateCached = Schema.Schema.Type<typeof MessageEmbedLiveStateCached>

// Loading state configuration for AI streaming messages
export const MessageEmbedLoadingState = Schema.Struct({
	/** Text to display while loading (default: "Thinking...") */
	text: Schema.optional(Schema.String),
	/** Icon to display: "sparkle" or "brain" (default: "sparkle") */
	icon: Schema.optional(Schema.Literals(["sparkle", "brain"])),
	/** Whether to show spinning animation on the icon (default: true) */
	showSpinner: Schema.optional(Schema.Boolean),
	/** Whether to pulse/throb the entire loading indicator (default: false) */
	throbbing: Schema.optional(Schema.Boolean),
})
export type MessageEmbedLoadingState = Schema.Schema.Type<typeof MessageEmbedLoadingState>

// Live state configuration for real-time updates
export const MessageEmbedLiveState = Schema.Struct({
	enabled: Schema.Literal(true),
	cached: Schema.optional(MessageEmbedLiveStateCached),
	/** Loading state configuration for the initial loading indicator */
	loading: Schema.optional(MessageEmbedLoadingState),
})
export type MessageEmbedLiveState = Schema.Schema.Type<typeof MessageEmbedLiveState>

/**
 * A sandboxed HTML page shown in the embed (`@hazel/domain/html-render`). The page lives in the
 * private `html-renders` bucket; clients load it through a short-lived signed URL
 * (`message.htmlRenderUrl`).
 */
export const MessageEmbedHtml = Schema.Struct({
	renderId: HtmlRenderId,
	title: Schema.String.check(Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH)),
	/** The frame's height before the page reports its own, in CSS pixels. */
	height: Schema.Int.check(
		Schema.isBetween({ minimum: HTML_RENDER_MIN_HEIGHT, maximum: HTML_RENDER_MAX_HEIGHT }),
	),
})
export type MessageEmbedHtml = Schema.Schema.Type<typeof MessageEmbedHtml>

/**
 * A button on a bot's embed. Clicking it sends the bot that posted the message an
 * `interaction.create` event carrying `id` (`message.interact`); nothing else happens until the bot
 * answers, typically by editing the message. `id` is the bot's own: up to 100 characters it gets
 * back verbatim.
 */
export const MessageEmbedAction = Schema.Struct({
	id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
	label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
	style: Schema.optional(Schema.Literals(["primary", "secondary", "danger"])),
	disabled: Schema.optional(Schema.Boolean),
})
export type MessageEmbedAction = Schema.Schema.Type<typeof MessageEmbedAction>

export const MESSAGE_EMBED_MAX_ACTIONS = 5

// Full embed schema (Discord-style)
export const MessageEmbed = Schema.Struct({
	title: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
	description: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
	url: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
	color: Schema.optional(
		Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 16777215 })),
	), // 0x000000 to 0xFFFFFF
	author: Schema.optional(MessageEmbedAuthor),
	footer: Schema.optional(MessageEmbedFooter),
	image: Schema.optional(Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(2048)) })),
	thumbnail: Schema.optional(Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(2048)) })),
	fields: Schema.optional(Schema.Array(MessageEmbedField).check(Schema.isMaxLength(25))),
	timestamp: Schema.optional(Schema.String), // ISO 8601 timestamp
	badge: Schema.optional(MessageEmbedBadge), // Status badge (e.g., "Deployed", "Failed")
	liveState: Schema.optional(MessageEmbedLiveState), // Live state for real-time updates
	html: Schema.optional(MessageEmbedHtml),
	actions: Schema.optional(
		Schema.Array(MessageEmbedAction).check(Schema.isMaxLength(MESSAGE_EMBED_MAX_ACTIONS)),
	),
})
export type MessageEmbed = Schema.Schema.Type<typeof MessageEmbed>

/** The enabled action `actionId` on any of `embeds`, if there is one. */
export const findEmbedAction = (
	embeds: ReadonlyArray<MessageEmbed> | null | undefined,
	actionId: string,
): MessageEmbedAction | undefined => {
	for (const embed of embeds ?? []) {
		const action = embed.actions?.find(
			(candidate) => candidate.id === actionId && candidate.disabled !== true,
		)
		if (action !== undefined) return action
	}
	return undefined
}

// Array of embeds for a message
export const MessageEmbeds = Schema.Array(MessageEmbed)
export type MessageEmbeds = Schema.Schema.Type<typeof MessageEmbeds>
