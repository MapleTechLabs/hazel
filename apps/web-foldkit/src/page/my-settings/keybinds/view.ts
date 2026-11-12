import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin } from "tailwind-merge"
import { appKeymap, KEYMAP_CATEGORIES } from "~/lib/keybindings/app-keymap"
import {
	comboLabel,
	comboSearchWords,
	keyCaps,
	type KeyCombo,
	modifierCaps,
	type Platform,
} from "~/lib/keybindings/key-combo"
import { IconArrowPath, IconClose, IconLock, IconWarning } from "../../../icons"
import { badge } from "../../../ui/badge"
import { ariaButton, button } from "../../../ui/button"
import { searchField } from "../../../ui/search-field"
import type { PageViewInputs, Shared } from "../../contract"
import { pageHeader } from "../shared"
import { Message } from "./message"
import type { Model } from "./model"
import { RECORDER_ATTRIBUTE } from "./subscription"

type H = HtmlBuilder<Message>
type AppAction = (typeof appKeymap.actions)[number]

// KEY CAPS

const cap = (h: H, label: string, tone: "default" | "live" = "default"): Html =>
	h.kbd(
		[
			h.Class(
				twJoin(
					"inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-mono text-xs/none",
					"shadow-[inset_0_-1px_0_var(--color-border)]",
					tone === "live"
						? "border-primary/40 bg-primary/10 text-primary"
						: "border-border bg-bg text-fg",
				),
			),
		],
		[label],
	)

const caps = (h: H, key: KeyCombo, platform: Platform): Html =>
	h.span(
		[h.Class("flex items-center gap-1")],
		keyCaps(key, platform).map((label) => cap(h, label)),
	)

// MATCHING

/**
 * The query as typed appears in the row's text or key label (`⌘K`, `Ctrl+K`), or each of its words
 * (split on spaces and `+`) starts a word of the row or a name of its keys: `cmd k`, `ctrl+shift`,
 * `esc`. A one-letter word only matches a key, so the `k` of `cmd k` is not the start of "keyboard".
 */
const matches = (action: AppAction, query: string, shared: Shared): boolean => {
	const needle = query.trim().toLowerCase()
	if (needle === "") return true
	const platform = shared.keyboardPlatform
	const keys = appKeymap.keysOf(shared.keys, action.id)
	const text = [action.label, action.description, action.category].join(" ").toLowerCase()
	const labels = keys.map((key) => comboLabel(key, platform).toLowerCase())
	if (text.includes(needle) || labels.some((label) => label.includes(needle))) return true
	const textWords = text.split(/\s+/)
	const keyWords = keys.flatMap((key) => comboSearchWords(key, platform))
	return needle
		.split(/[\s+]+/)
		.filter((token) => token !== "")
		.every((token) =>
			[...token].length === 1
				? keyWords.includes(token)
				: [...textWords, ...keyWords].some((word) => word.startsWith(token)),
		)
}

// ROW PARTS

/** The key button: shows the key, and records a new one when pressed. */
const recorder = (h: H, model: Model, action: AppAction, shared: Shared): Html => {
	const isRecording = model.recording === action.id
	const key = shared.keys[action.id]
	const live = modifierCaps(new Set(model.held), shared.keyboardPlatform)
	const content: Array<Html> = isRecording
		? [
				...live.map((label) => cap(h, label, "live")),
				h.span(
					[h.Class("flex items-center gap-1.5 text-primary text-xs")],
					[
						h.span(
							[h.Class("relative flex size-2")],
							[
								h.span([
									h.Class(
										"absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden",
									),
								]),
								h.span([h.Class("relative inline-flex size-2 rounded-full bg-primary")]),
							],
						),
						live.length === 0 ? "Press a shortcut" : "Now a key",
					],
				),
			]
		: key === null
			? [h.span([h.Class("text-muted-fg text-xs")], ["Not set"])]
			: [caps(h, key, shared.keyboardPlatform)]
	return ariaButton(
		h,
		{
			className: twJoin(
				"flex h-9 min-w-36 items-center justify-end justify-self-end gap-1 rounded-lg border px-2 outline-none transition-colors duration-150",
				"focus-visible:ring-2 focus-visible:ring-ring/40",
				isRecording
					? "border-primary bg-primary/5 ring-4 ring-primary/15"
					: "border-transparent hover:border-border hover:bg-secondary/50",
			),
			onPress: Message.ClickedRecord({ actionId: action.id }),
			attributes: [
				h.Attribute(RECORDER_ATTRIBUTE, ""),
				h.AriaLabel(
					isRecording
						? `Recording a new key for ${action.label}. Press Escape to cancel.`
						: `${action.label}: ${key === null ? "not set" : comboLabel(key, shared.keyboardPlatform)}. Press to change.`,
				),
				...(isRecording ? [h.Attribute("aria-pressed", "true")] : []),
			],
		},
		content,
	)
}

const iconButton = (h: H, label: string, onPress: Message, icon: Html, className?: string): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-sm",
			className,
			onPress,
			attributes: [h.AriaLabel(label), h.Attribute("title", label)],
		},
		[icon],
	)

/** Reset and unbind, in fixed slots so the key buttons line up whichever show. */
const rowActions = (h: H, action: AppAction, shared: Shared): Html => {
	// Changed: overridden, or its default lost to another action's override (Reset takes it back).
	const isChanged =
		appKeymap.isOverridden(shared.keybindingOverrides, action.id) ||
		shared.keys[action.id] !== action.defaultKey
	const isBound = shared.keys[action.id] !== null
	const defaultLabel =
		action.defaultKey === null ? "none" : comboLabel(action.defaultKey, shared.keyboardPlatform)
	return h.div(
		[h.Class("flex w-16 shrink-0 items-center justify-end gap-0.5")],
		[
			isChanged
				? iconButton(
						h,
						`Reset to default (${defaultLabel})`,
						Message.ClickedReset({ actionId: action.id }),
						IconArrowPath(h),
					)
				: h.span([h.Class("size-7")]),
			isBound
				? iconButton(
						h,
						"Remove keybind",
						Message.ClickedUnbind({ actionId: action.id }),
						IconClose(h),
						// Quiet until the row is hovered or focused; always there on touch screens.
						"opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100",
					)
				: h.span([h.Class("size-7")]),
		],
	)
}

const noticeLine = (h: H, model: Model, action: AppAction): Array<Html> => {
	const notice = model.notice
	if (notice === null || notice.actionId !== action.id) return []
	return [
		h.p(
			[
				h.Class(
					twJoin(
						"col-span-full flex items-center gap-1.5 text-xs",
						notice.tone === "warning" ? "text-warning-subtle-fg" : "text-muted-fg",
					),
				),
				h.Attribute("role", "status"),
			],
			[
				...(notice.tone === "warning" ? [IconWarning(h, { className: "size-3.5 shrink-0" })] : []),
				notice.text,
			],
		),
	]
}

const rowLabel = (h: H, action: AppAction, isCustom: boolean): Html =>
	h.div(
		// On a phone the label takes its own line, so the key column never cuts it to a stub.
		[h.Class("flex min-w-0 flex-col gap-0.5 max-md:col-span-full")],
		[
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					h.span([h.Class("truncate font-medium text-fg text-sm")], [action.label]),
					...(isCustom ? [badge(h, { intent: "primary", size: "sm" }, ["Custom"])] : []),
				],
			),
			h.span([h.Class("truncate text-muted-fg text-xs")], [action.description]),
		],
	)

const editableRow = (h: H, model: Model, action: AppAction, shared: Shared): Html =>
	h.li(
		[
			h.Class(
				twJoin(
					"group/row grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 transition-colors duration-150 max-md:grid-cols-[1fr_auto]",
					model.recording === action.id && "bg-primary/[0.03]",
				),
			),
		],
		[
			rowLabel(h, action, appKeymap.isOverridden(shared.keybindingOverrides, action.id)),
			recorder(h, model, action, shared),
			rowActions(h, action, shared),
			...noticeLine(h, model, action),
		],
	)

/** A built-in key: listed so you know it is taken, not changeable. */
const fixedRow = (h: H, action: AppAction, shared: Shared): Html =>
	h.li(
		[
			h.Class(
				"grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 max-md:grid-cols-[1fr_auto]",
			),
		],
		[
			rowLabel(h, action, false),
			h.span(
				[h.Class("flex min-w-36 items-center justify-end justify-self-end gap-2 px-2")],
				appKeymap.keysOf(shared.keys, action.id).map((key) => caps(h, key, shared.keyboardPlatform)),
			),
			h.span(
				[h.Class("flex w-16 justify-end pr-2 text-muted-fg"), h.Attribute("title", "Built in")],
				[IconLock(h, { className: "size-3.5", title: "Built in" })],
			),
		],
	)

// SECTIONS

const section = (
	h: H,
	model: Model,
	category: string,
	actions: ReadonlyArray<AppAction>,
	shared: Shared,
): Html => {
	const isFixed = actions.every((action) => !action.rebindable)
	return h.section(
		[h.AriaLabel(category), h.Class("flex flex-col gap-2")],
		[
			h.div(
				[h.Class("flex items-baseline justify-between px-1")],
				[
					h.h3([h.Class("font-medium text-muted-fg text-xs uppercase tracking-wide")], [category]),
					...(isFixed ? [h.span([h.Class("text-muted-fg text-xs")], ["Built in"])] : []),
				],
			),
			h.ul(
				[h.Class("divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg")],
				actions.map((action) =>
					action.rebindable ? editableRow(h, model, action, shared) : fixedRow(h, action, shared),
				),
			),
		],
	)
}

const toolbar = (h: H, model: Model, shared: Shared): Html => {
	const customized = Object.keys(shared.keybindingOverrides).length
	return h.div(
		[h.Class("flex flex-wrap items-center gap-3")],
		[
			h.div(
				[h.Class("w-72 max-md:w-full")],
				[
					searchField(
						h,
						{
							id: "keybinds-search",
							value: model.query,
							onInput: (value) => Message.ChangedQuery({ value }),
							onClear: Message.ClearedQuery(),
							ariaLabel: "Search shortcuts",
						},
						(parts) => [parts.searchInput({ placeholder: "Search shortcuts" })],
					),
				],
			),
			h.span(
				[h.Class("ml-auto text-muted-fg text-xs")],
				[customized === 0 ? "All defaults" : `${customized} customized`],
			),
			button(
				h,
				{
					intent: "outline",
					size: "sm",
					isDisabled: customized === 0,
					onPress: Message.ClickedResetAll(),
				},
				["Reset all"],
			),
		],
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const sections = KEYMAP_CATEGORIES.flatMap((category) => {
		const actions = appKeymap.actions.filter(
			(action) => action.category === category && matches(action, model.query, shared),
		)
		return actions.length === 0 ? [] : [section(h, model, category, actions, shared)]
	})
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 pb-8 lg:px-8")],
		[
			pageHeader(
				h,
				"Keybinds",
				"Press a shortcut to record a new one. Changes apply right away, on this device.",
			),
			toolbar(h, model, shared),
			...(sections.length === 0
				? [
						h.p(
							[
								h.Class(
									"rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-fg text-sm",
								),
							],
							[`No shortcuts match “${model.query.trim()}”.`],
						),
					]
				: sections),
		],
	)
})
