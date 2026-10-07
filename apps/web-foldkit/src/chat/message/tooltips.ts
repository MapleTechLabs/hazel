import type { Html, HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { formatStatusExpiration } from "~/utils/status"
import type { AggregatedReaction, StatusEmoji } from "../../page/chat/rows"
import * as TooltipHost from "../tooltip-host"

/** Tooltip-wrapped message parts: `ReactionButton` and `StatusEmojiWithTooltip`. */

export interface TooltipContext<M> {
	readonly active: TooltipHost.Model
	readonly hoveredKey: string | null
	readonly toMessage: (message: TooltipHost.Message) => M
	/** Display names for the reaction tooltip ("You" for the signed-in user). */
	readonly userName: (userId: string) => string | null
	readonly currentUserId: string | null
}

const PRESSABLE = <M>(h: HtmlBuilder<M>) => [
	h.Attribute("data-rac", ""),
	h.Attribute("data-react-aria-pressable", "true"),
	h.Attribute("tabindex", "0"),
	h.Attribute("type", "button"),
]

/** `ReactionUserList`: current user first, three names, then "and N others". */
const reactedBy = <M>(
	h: HtmlBuilder<M>,
	reaction: AggregatedReaction,
	context: TooltipContext<M>,
): ReadonlyArray<Html | string> => {
	if (reaction.userIds.length === 0) return []
	const sorted = [...reaction.userIds].sort((a, b) =>
		a === context.currentUserId ? -1 : b === context.currentUserId ? 1 : 0,
	)
	const shown = sorted.slice(0, 3)
	const remaining = sorted.length - 3
	const nameOf = (userId: string) => {
		if (userId === context.currentUserId) return h.span([], ["You"])
		const name = context.userName(userId)
		return name === null ? h.span([h.Class("text-muted-fg")], ["Loading..."]) : h.span([], [name])
	}
	return [
		"reacted by",
		" ",
		...shown.map((userId, index) =>
			h.span(
				[],
				[
					nameOf(userId),
					index < shown.length - 1 && remaining <= 0 && index === shown.length - 2
						? " and "
						: index < shown.length - 1
							? ", "
							: "",
				],
			),
		),
		...(remaining > 0
			? [h.span([], [", and ", String(remaining), " ", remaining === 1 ? "other" : "others"])]
			: []),
	]
}

export const reactionButton = <M>(
	h: HtmlBuilder<M>,
	messageId: string,
	reaction: AggregatedReaction,
	context: TooltipContext<M>,
): Html =>
	TooltipHost.tooltipTrigger(h, {
		key: `${messageId}:reaction:${reaction.emoji}`,
		active: context.active,
		hoveredKey: context.hoveredKey,
		delayMs: 300,
		toMessage: context.toMessage,
		placement: "top",
		className: "flex items-center gap-3 px-3 py-2",
		toTrigger: (attributes, overlay) =>
			h.button(
				[
					...attributes,
					h.Class(
						cn(
							"inline-flex size-max cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-medium text-sm ring ring-inset transition-colors",
							reaction.hasReacted
								? "bg-primary/10 text-primary ring-primary/20 hover:bg-primary/20"
								: "bg-secondary text-fg ring-border hover:bg-secondary/80",
						),
					),
					...PRESSABLE(h),
				],
				[
					reaction.imageUrl
						? h.img([
								h.Attribute("src", reaction.imageUrl),
								h.Attribute("alt", reaction.emoji),
								h.Class("size-5 object-contain"),
							])
						: reaction.emoji,
					" ",
					String(reaction.count),
					overlay,
				],
			),
		content: [
			reaction.imageUrl
				? h.img([
						h.Attribute("src", reaction.imageUrl),
						h.Attribute("alt", reaction.emoji),
						h.Class("size-7 object-contain"),
					])
				: h.span([h.Class("text-3xl")], [reaction.emoji]),
			h.span([h.Class("text-sm")], [...reactedBy(h, reaction, context)]),
		],
	})

/** `StatusEmojiWithTooltip` (interactive, no quiet hours). */
export const statusEmojiView = <M>(
	h: HtmlBuilder<M>,
	messageId: string,
	status: StatusEmoji | null,
	context: TooltipContext<M>,
): Html => {
	if (status === null) return h.empty
	const expiration = formatStatusExpiration(
		status.expiresAtMs === null ? null : new Date(status.expiresAtMs),
	)
	return TooltipHost.tooltipTrigger(h, {
		key: `${messageId}:status`,
		active: context.active,
		hoveredKey: context.hoveredKey,
		delayMs: 300,
		toMessage: context.toMessage,
		placement: "top",
		toTrigger: (attributes, overlay) =>
			h.button(
				[
					...attributes,
					h.Class(cn("cursor-default border-none bg-transparent p-0 text-sm")),
					...PRESSABLE(h),
				],
				[status.emoji, overlay],
			),
		content:
			status.message || expiration
				? [
						h.div(
							[h.Class("flex flex-col gap-0.5")],
							[
								h.div(
									[],
									[
										h.span([h.Class("text-base")], [status.emoji]),
										" ",
										status.message ?? "",
									],
								),
								...(expiration
									? [h.div([h.Class("text-muted-fg text-xs")], ["Until ", expiration])]
									: []),
							],
						),
					]
				: [h.span([h.Class("text-base")], [status.emoji])],
	})
}
