import { anchorSetup, AnchorConfig } from "@foldkit/ui/anchor"
import * as FoldkitTooltip from "@foldkit/ui/tooltip"
import { Duration, Effect, Schema } from "effect"
import { Mount, Submodel } from "foldkit"
import { type ChildAttribute, type Html, type HtmlBuilder } from "foldkit/html"
import { twJoin } from "tailwind-merge"
import {
	tooltipArrowBase,
	tooltipArrowDefault,
	tooltipArrowInverse,
	tooltipStyles,
} from "~/components/ui/tooltip.styles"
import { type Placement, toAnchorPlacement } from "./aria/placement"

/**
 * The `@foldkit/ui` Tooltip, styled. Hover shows it after the show delay, keyboard focus at once,
 * and leaving, blurring or Escape on the trigger hides it; the handlers live in the trigger bundle.
 * The panel is positioned by Anchor with an arrow, so it renders its own panel attributes.
 */

// MODEL

/** React Aria TooltipTrigger's default `delay`. */
const DEFAULT_SHOW_DELAY_MS = 1500

export const { Model, Message, OutMessage, update, triggerId, WaitBeforeShowing } = FoldkitTooltip
export type Model = FoldkitTooltip.Model
export type Message = FoldkitTooltip.Message
export type OutMessage = FoldkitTooltip.OutMessage

export const init = (id: string, showDelayMs: number = DEFAULT_SHOW_DELAY_MS): Model =>
	FoldkitTooltip.init({ id, showDelay: Duration.millis(showDelayMs) })

/** The panel id the trigger bundle's `aria-describedby` names. */
export const tooltipId = (id: string) => `${id}-panel`
const arrowId = (id: string) => `${id}-arrow`

// MOUNT

/** The kit's `AnchorTooltip` plus the arrow, which Anchor offsets through `--arrow-x`/`--arrow-y`. */
export const AnchorTooltipPanel = Mount.define("AnchorTooltipPanel", {
	args: { buttonId: Schema.String, anchor: AnchorConfig, arrowId: Schema.String },
	messages: [Message.CompletedAnchorTooltip],
	execute: ({ element, buttonId, anchor, arrowId }) =>
		Effect.gen(function* () {
			yield* Effect.acquireRelease(
				Effect.sync(() => anchorSetup(element, { buttonId, anchor, arrowId, interceptTab: false })),
				(cleanup) => Effect.sync(cleanup),
			)
			return Message.CompletedAnchorTooltip()
		}),
})

// VIEW

export type ViewInputs = Readonly<{
	/** Renders the trigger. Spread `attributes` on it and put `overlay` last. */
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	content: ReadonlyArray<Html | string>
	placement?: Placement
	offset?: number
	arrow?: boolean
	inverse?: boolean
	className?: string
}>

const TOOLTIP_OFFSET = 10
const VIEWPORT_PADDING = 8

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const anchor: AnchorConfig = {
		placement: toAnchorPlacement(viewInputs.placement ?? "top"),
		gap: viewInputs.offset ?? TOOLTIP_OFFSET,
		padding: VIEWPORT_PADDING,
	}
	return FoldkitTooltip.view(
		model,
		{
			anchor,
			// The keyed slot stays in the trigger while the panel inside it is portaled to <body>, so a
			// sibling overlay opening in the same patch (the emoji picker) inserts before a node that is there.
			toView: ({ trigger, isVisible }) =>
				viewInputs.toTrigger(
					trigger,
					isVisible
						? h.keyed("div")(
								`tooltip-slot-${model.id}`,
								[h.Style({ display: "contents" })],
								[panel(model.id, anchor, viewInputs, h)],
							)
						: h.empty,
				),
		},
		h,
	)
})

const sideOf = (anchor: AnchorConfig) => {
	const placement = anchor.placement ?? "top"
	return placement.startsWith("top")
		? "top"
		: placement.startsWith("bottom")
			? "bottom"
			: placement.startsWith("left")
				? "left"
				: "right"
}

const panel = (id: string, anchor: AnchorConfig, viewInputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
	const inverse = viewInputs.inverse ?? false
	return h.div(
		[
			h.Id(tooltipId(id)),
			h.Role("tooltip"),
			h.Style({ position: "absolute", margin: "0", visibility: "hidden", pointerEvents: "none" }),
			h.DataAttribute("open", ""),
			h.Class(tooltipStyles({ inverse, side: sideOf(anchor), className: viewInputs.className })),
			h.OnMount(AnchorTooltipPanel({ buttonId: triggerId(id), anchor, arrowId: arrowId(id) })),
		],
		[
			...((viewInputs.arrow ?? true)
				? [
						h.svg(
							[
								h.Id(arrowId(id)),
								h.Attribute("width", "12"),
								h.Attribute("height", "12"),
								h.Attribute("viewBox", "0 0 12 12"),
								h.AriaHidden(true),
								h.Class(
									twJoin(
										tooltipArrowBase,
										inverse ? tooltipArrowInverse : tooltipArrowDefault,
									),
								),
							],
							[h.path([h.Attribute("d", "M0 0 L6 6 L12 0")])],
						),
					]
				: []),
			...viewInputs.content,
		],
	)
}
