// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Places one of the shell's children inside a Foldkit page that still draws around it: the page
 * leaves an empty hole (`../app/holes.ts`) and the child's element moves in. The child stays an
 * ordinary child of the shell (its props, events, services); only its element sits elsewhere.
 * Part of the adapter.
 */
import type { View } from "@effect/ui"
import { Mount } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { Effect, Schema, Stream } from "effect"
import { HOLE_ATTRIBUTE, HOLE_KEY_ATTRIBUTE, type HoleName } from "../app/holes"

/** How long a released element may wait in its old hole for the page to replace it, in ms. */
const LINGER_MS = 1000

/**
 * Moves the element into the current hole of `hole` (the one keyed `key`, when given), follows a new
 * hole when the page replaces it, and takes the element out when it unmounts (the renderer removes
 * its parent, not the element).
 */
export const PlaceInHole = Mount.makeStream(
	"PlaceInHole",
	{ args: { hole: Schema.String, key: Schema.String } },
	(node: HTMLElement, { hole, key }) =>
		Stream.unwrap(
			Effect.acquireRelease(
				Effect.sync(() => {
					const document = node.ownerDocument
					const home = node.parentElement
					const selector =
						key === ""
							? `[${HOLE_ATTRIBUTE}="${hole}"]`
							: `[${HOLE_ATTRIBUTE}="${hole}"][${HOLE_KEY_ATTRIBUTE}="${CSS.escape(key)}"]`
					const place = () => {
						const target = document.querySelector(selector)
						if (target !== null) {
							if (node.parentElement !== target) target.appendChild(node)
						} else if (home !== null && node.parentElement !== home) home.appendChild(node)
					}
					// Placed in the same turn as the page's patch (a microtask), so no frame shows the hole empty.
					const observer = new MutationObserver(place)
					observer.observe(document.body, { childList: true, subtree: true })
					place()
					return () => {
						observer.disconnect()
						if (node.parentElement === home) return
						// A keyed hole is the page's for this child alone: the page drops it on its next patch.
						if (key === "") node.remove()
						else linger(node)
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.as(Stream.never)),
		),
)

/**
 * Takes a released element out of its hole. While the page still shows that hole (the shell switched
 * first, as on a channel switch), it stays, inert, until the page replaces the hole or fills it anew.
 */
const linger = (node: HTMLElement) => {
	const hole = node.parentElement
	if (hole === null || !hole.hasAttribute(HOLE_ATTRIBUTE) || !hole.isConnected) return node.remove()
	node.setAttribute("inert", "")
	const view = node.ownerDocument.defaultView
	const done = () => {
		observer.disconnect()
		if (timer !== undefined) view?.clearTimeout(timer)
		node.remove()
	}
	const observer = new MutationObserver(() => {
		if (!hole.isConnected || hole.lastElementChild !== node) done()
	})
	observer.observe(node.ownerDocument.body, { childList: true, subtree: true })
	const timer = view?.setTimeout(done, LINGER_MS)
}

/**
 * A child rendered into a Foldkit page's hole: a hidden home holds its element until the hole is
 * there. Write it as one unit, so the renderer only ever removes the home, never the moved element.
 */
export const Hole = <M, C extends View.Children<M>>(
	h: Html.H<M>,
	options: {
		readonly hole: HoleName
		readonly key: string
		readonly className?: string
		/** Lands only in the hole the page keyed `key` too (`../app/holes.ts`), not one it is replacing. */
		readonly matchKey?: boolean
	},
	child: C,
) =>
	h.div
		.key(`hole:${options.hole}:${options.key}`)
		.attr("hidden", "")
		.attr("data-hazel-home", options.hole)
		.children(
			h.div
				.class(options.className ?? "contents")
				.onMount(
					PlaceInHole({ hole: options.hole, key: options.matchKey === true ? options.key : "" }),
				)
				.children(child),
		)
