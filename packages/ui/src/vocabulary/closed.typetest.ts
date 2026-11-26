// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Type-level checks, run by `bun run typecheck`: each `@ts-expect-error` must stay an error. They prove
 * the closed sets and the closed escape hatches (`attr`, `attrs`, `prop`, `h.el`, text placement).
 */
import { MeshBackground } from "../demo/extensions.ts"
import type { H } from "./Hazel.ts"

export const closed = (h: H<"m">) => [
	h.item.title("ok").badge(2).selected().href("#/x").leading(h.icon.name("hashtag")).on("press", "m"),
	h.text.role("caption").tone("muted").strong().children("text goes here"),
	h.extension(MeshBackground, { colors: ["brand.500"], speed: 1 }).on("Tapped", "m"),
	// @ts-expect-error raw attributes are closed
	h.item.attr("class", "p-4"),
	// @ts-expect-error raw attributes are closed
	h.item.attrs({ style: "color: red" }),
	// @ts-expect-error raw props are closed
	h.item.prop("color", "red"),
	// @ts-expect-error `h.el` is closed in shared screens
	h.el("div"),
	// @ts-expect-error options come from closed sets
	h.text.tone("purple"),
	// @ts-expect-error icon names are a closed set
	h.icon.name("rocket"),
	// @ts-expect-error a prop belongs to its tag: `badge` is an item's
	h.section.badge(3),
	// @ts-expect-error text goes inside `text`, not in a container
	h.section.children("loose text"),
	// @ts-expect-error extension props are typed by its Schema
	h.extension(MeshBackground, { colors: ["#ff0000"], speed: 1 }),
	// @ts-expect-error extension events are typed
	h.extension(MeshBackground, { colors: [], speed: 1 }).on("Pressed", "m"),
	// @ts-expect-error `press` is an item's and an action's event only
	h.text.on("press", "m"),
]

/** C1: every tag's props, slots and events are typed from `spec.ts`. */
export const contract = (h: H<"m">) => [
	h.stack.axis("horizontal").density("compact").align("center").children(h.spacer, h.divider),
	h.button.label("Save").icon("plus").variant("ghost").size("xsmall").iconOnly().on("press", "m"),
	h.message
		.row({ t: "14:05", b: [[0, ["hi ", [1, "@Ada", "u1"]]]], r: [["👍", 2, 1]] })
		.pinned()
		.on("action", ({ action }) => (action === "reply" ? "m" : "m")),
	h.list.anchor("end").stickToBottom().on("reachStart", "m").children(h.listDivider.kind("unread")),
	h.textField.value({ text: "", rev: 0, edit: 0 }).on("change", ({ rev }) => (rev > 0 ? "m" : "m")),
	h.menu.entries([{ entries: [{ id: "a", label: "A" }] }]).trigger(h.button.label("Open")),
	h.section.title("S").action(h.icon.name("plus"), "m", "Add").children(h.item.title("x")),
	// @ts-expect-error a leaf takes no children
	h.button.children(h.text.children("label")),
	// @ts-expect-error options come from closed sets
	h.stack.density("tight"),
	// @ts-expect-error button variants are closed
	h.button.variant("link"),
	// @ts-expect-error structured props are typed: a reaction is [emoji, count, mine]
	h.reactionBar.reactions([["👍", "2", 1]]),
	// @ts-expect-error message actions are a closed set
	h.message.on("action", ({ action }) => (action === "explode" ? "m" : "m")),
	// @ts-expect-error slots belong to their tag
	h.button.leading(h.icon.name("plus")),
	// @ts-expect-error internal tags are not named in a screen
	h.slot,
	// @ts-expect-error a controlled value is the revision State, not a string
	h.textField.value("text"),
]
