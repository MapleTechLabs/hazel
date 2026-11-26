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
