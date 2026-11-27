// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Where the AI assistant panel (`@hazel/shared-screens/assistant/AssistantPanel`) sits in the frame:
 * the shell owns whether it is open and how wide, stores both, and draws its column (today's
 * `split-panel` aside with its resize edge, full screen on a phone) and the nav rail's toggle.
 */
import { Command, Component, Mount } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Assistant } from "@hazel/domain/models"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { readStored, writeStored } from "../data/storage"
import { IconSparkles } from "../icons"
import { PANEL_MARK, routeContextOf } from "../page/assistant-context"
import { type AppRoute, hrefOf, integrationRoute } from "../route"
import { button } from "../ui/button"
import { resizeEdge, splitPanelClassName } from "../ui/split-panel"
import { fromKit, kit } from "./kit"

/** What the shell keeps across loads: open on a wide screen, and its width. */
export const Stored = Schema.Struct({ isOpen: Schema.Boolean, width: Schema.NullOr(Schema.Finite) })
export type Stored = typeof Stored.Type

export const PANEL_ID = "ai-panel"
export const TOGGLE_ID = "ai-panel-toggle"

export const DEFAULT_WIDTH = 420
export const MIN_WIDTH = 320
/** The page always keeps this much room beside the panel. */
const MIN_PAGE_WIDTH = 480
/** Arrow keys have no layout to read, so they stop here; the column's max-width still applies. */
const MAX_KEYBOARD_WIDTH = 960
const KEYBOARD_STEP = 24

export const clampWidth = (width: number, maxWidth: number) =>
	Math.round(Math.max(MIN_WIDTH, Math.min(width, maxWidth)))

/** A phone opens the panel over the page: it never starts open there. */
export const initialStored = (stored: Stored, isMobile: boolean): Stored => ({
	isOpen: stored.isOpen && !isMobile,
	width: stored.width === null ? null : clampWidth(stored.width, MAX_KEYBOARD_WIDTH),
})

/** What the panel sends as "where the member is": the Foldkit page's own, else the route's. */
export const assistantContextOf = (
	route: AppRoute,
	pageContext: Assistant.Context | null | undefined,
): Assistant.Context | null => pageContext ?? routeContextOf(route)

export const setupHrefOf = (orgSlug: string) => hrefOf(integrationRoute(orgSlug, "t3code"))

// STORAGE

const STORAGE_KEY = "hazel-ai-panel"
const StoredCodec = Schema.toCodecJson(Stored)

/** Read once before the first render (`entry.ts`), so an open panel never flashes in. */
export const loadStored: Effect.Effect<Stored> = readStored(STORAGE_KEY, StoredCodec).pipe(
	Effect.map(Option.getOrElse((): Stored => ({ isOpen: false, width: null }))),
)

// Best effort: a full or blocked store only forgets the panel.
export const SaveAssistantPanel = Command.make(
	"SaveAssistantPanel",
	{ args: { stored: Stored } },
	({ stored }) =>
		writeStored(STORAGE_KEY, StoredCodec, stored).pipe(Effect.ignore, Effect.as(Component.noop)),
)

/**
 * Back to the toggle once the panel closed, when focus was in it (it fell to the body); focus the
 * member moved elsewhere stays there.
 */
export const FocusAssistantToggle = Command.make("FocusAssistantToggle", { args: {} }, () =>
	Effect.sync(() => {
		const active = document.activeElement
		const isLost = active === null || active === document.body || active.closest(`#${PANEL_ID}`) !== null
		if (isLost) document.getElementById(TOGGLE_ID)?.focus()
		return Component.noop
	}),
)

// THE COLUMN

/** What the column reports: a new width (a drag released, an arrow key), or Escape inside it. */
export type ColumnEvent = { readonly _tag: "Resized"; readonly width: number } | { readonly _tag: "Escaped" }

/** The page beside the panel (the sidebar inset): the panel may take what it has beyond its minimum. */
const maxWidthOf = (node: HTMLElement, fallback: number) => {
	const page = node.parentElement?.querySelector('[data-slot="sidebar-inset"]') ?? null
	return page === null
		? fallback
		: page.getBoundingClientRect().width + node.getBoundingClientRect().width - MIN_PAGE_WIDTH
}

/** The edge's drag and arrow keys (the width shows live, then reports once), and Escape in the panel. */
export const TrackAssistantColumn = Mount.makeStream(
	"TrackAssistantColumn",
	{ args: {} },
	(node: HTMLElement) =>
		Stream.callback<ColumnEvent>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const view = node.ownerDocument.defaultView
					const edge = node.querySelector<HTMLElement>('[role="separator"]')
					const frame = node.parentElement
					let drag: { startX: number; startWidth: number; maxWidth: number } | null = null
					const show = (width: number) => {
						node.style.width = `${width}px`
						edge?.setAttribute("aria-valuenow", String(width))
					}
					const dragging = (on: boolean) => {
						edge?.setAttribute("data-dragging", String(on))
						frame?.classList.toggle("cursor-col-resize", on)
						frame?.classList.toggle("select-none", on)
					}
					const onMove = (event: PointerEvent) => {
						if (drag !== null)
							show(clampWidth(drag.startWidth + drag.startX - event.clientX, drag.maxWidth))
					}
					const onUp = () => {
						if (drag === null) return
						drag = null
						dragging(false)
						view?.removeEventListener("pointermove", onMove)
						Queue.offerUnsafe(queue, {
							_tag: "Resized",
							width: node.getBoundingClientRect().width,
						})
					}
					const onDown = (event: PointerEvent) => {
						if (event.button !== 0) return
						event.preventDefault()
						const startWidth = node.getBoundingClientRect().width
						drag = {
							startX: event.clientX,
							startWidth,
							maxWidth: Math.max(MIN_WIDTH, maxWidthOf(node, MAX_KEYBOARD_WIDTH)),
						}
						dragging(true)
						view?.addEventListener("pointermove", onMove)
					}
					const onKey = (event: KeyboardEvent) => {
						if (event.defaultPrevented) return
						if (event.key === "Escape") {
							event.preventDefault()
							Queue.offerUnsafe(queue, { _tag: "Escaped" })
							return
						}
						if (
							event.target !== edge ||
							(event.key !== "ArrowLeft" && event.key !== "ArrowRight")
						)
							return
						event.preventDefault()
						const max = Math.max(
							MIN_WIDTH,
							Math.min(maxWidthOf(node, MAX_KEYBOARD_WIDTH), MAX_KEYBOARD_WIDTH),
						)
						const delta = event.key === "ArrowLeft" ? KEYBOARD_STEP : -KEYBOARD_STEP
						const width = clampWidth(node.getBoundingClientRect().width + delta, max)
						show(width)
						Queue.offerUnsafe(queue, { _tag: "Resized", width })
					}
					edge?.addEventListener("pointerdown", onDown)
					view?.addEventListener("pointerup", onUp)
					view?.addEventListener("pointercancel", onUp)
					node.addEventListener("keydown", onKey)
					return () => {
						edge?.removeEventListener("pointerdown", onDown)
						view?.removeEventListener("pointermove", onMove)
						view?.removeEventListener("pointerup", onUp)
						view?.removeEventListener("pointercancel", onUp)
						node.removeEventListener("keydown", onKey)
						dragging(false)
					}
				}),
				(release) => Effect.sync(release),
			),
		),
)

/**
 * The widest the panel may be: the window less the page's minimum and the sidebar (its nav rail
 * when docked). On a narrow window it keeps its own minimum rather than getting squeezed.
 */
const maxWidthStyle = (isSidebarCollapsed: boolean) =>
	`max(${MIN_WIDTH}px, calc(100% - ${MIN_PAGE_WIDTH}px - var(${isSidebarCollapsed ? "--sidebar-width-dock" : "--sidebar-width"})))`

export interface ColumnInputs {
	readonly isOpen: boolean
	readonly isMobile: boolean
	readonly width: number | null
	readonly isSidebarCollapsed: boolean
}

/**
 * The panel's column, drawn closed too (hidden) so the panel keeps its chat and draft. Wide, an
 * aside beside the page with the resize edge; on a phone it covers the screen.
 */
export const column = <M>(
	h: Html.H<M>,
	inputs: ColumnInputs,
	onColumn: (event: ColumnEvent) => M,
	panel: unknown,
) => {
	const width = inputs.width ?? DEFAULT_WIDTH
	const attrs = {
		id: PANEL_ID,
		[PANEL_MARK]: "",
		"aria-label": "AI assistant",
		hidden: inputs.isOpen ? undefined : "",
	}
	const tracked = TrackAssistantColumn().pipe(Mount.map(onColumn))
	if (inputs.isMobile)
		return h.aside
			.key("assistant:phone")
			.attrs({ ...attrs, role: "dialog", "aria-modal": "true" })
			.class(
				"fixed inset-0 z-50 flex flex-col bg-overlay text-overlay-fg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
			)
			.onMount(tracked)
			.children(panel as never)
	return h.aside
		.key("assistant:wide")
		.attrs(attrs)
		.class(splitPanelClassName("right", "sticky top-0 h-dvh"))
		.style({
			width: `${width}px`,
			minWidth: `${MIN_WIDTH}px`,
			maxWidth: maxWidthStyle(inputs.isSidebarCollapsed),
		})
		.onMount(tracked)
		.children(
			fromKit(
				h,
				resizeEdge(kit, {
					label: "Resize assistant panel",
					position: "right",
					width,
					minWidth: MIN_WIDTH,
					maxWidth: MAX_KEYBOARD_WIDTH,
					isDragging: false,
					onPress: () => "",
					onNudge: () => "",
				}),
			),
			h.div.class("flex h-full min-h-0 flex-1 flex-col overflow-hidden").children(panel as never),
		)
}

/** The nav rail's toggle (today's `toggleButton`); `shortcut` is its key's label ("⌘J"). */
export const toggleButton = <M>(h: Html.H<M>, isOpen: boolean, shortcut: string | null, onPress: M) =>
	fromKit(
		h,
		button(
			kit,
			{
				intent: "plain",
				size: "sq-md",
				className: isOpen ? "bg-sidebar-accent text-sidebar-accent-fg" : undefined,
				attributes: [
					kit.Id(TOGGLE_ID),
					kit.AriaLabel("AI assistant"),
					kit.Attribute("title", shortcut === null ? "AI assistant" : `AI assistant (${shortcut})`),
					kit.AriaPressed(isOpen ? "true" : "false"),
				],
			},
			[IconSparkles(kit, { className: "size-5" })],
		),
		{ press: onPress },
	)
