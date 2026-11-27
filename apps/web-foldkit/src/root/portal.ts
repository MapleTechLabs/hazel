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
import { HOLE_ATTRIBUTE, type HoleName } from "../app/holes"

/**
 * Moves the element into the current hole of `hole`, follows a new hole when the page replaces it,
 * and takes the element out when it unmounts (the renderer removes its parent, not the element).
 */
export const PlaceInHole = Mount.makeStream(
	"PlaceInHole",
	{ args: { hole: Schema.String } },
	(node: HTMLElement, { hole }) =>
		Stream.unwrap(
			Effect.acquireRelease(
				Effect.sync(() => {
					const document = node.ownerDocument
					const view = document.defaultView
					const home = node.parentElement
					let frame = 0
					const place = () => {
						frame = 0
						const target = document.querySelector(`[${HOLE_ATTRIBUTE}="${hole}"]`)
						if (target !== null) {
							if (node.parentElement !== target) target.appendChild(node)
						} else if (home !== null && node.parentElement !== home) home.appendChild(node)
					}
					const observer = new MutationObserver(() => {
						if (frame === 0) frame = view?.requestAnimationFrame(place) ?? 0
					})
					observer.observe(document.body, { childList: true, subtree: true })
					place()
					return () => {
						observer.disconnect()
						if (frame !== 0) view?.cancelAnimationFrame(frame)
						if (node.parentElement !== home) node.remove()
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.as(Stream.never)),
		),
)

/**
 * A child rendered into a Foldkit page's hole: a hidden home holds its element until the hole is
 * there. Write it as one unit, so the renderer only ever removes the home, never the moved element.
 */
export const Hole = <M, C extends View.Children<M>>(
	h: Html.H<M>,
	options: { readonly hole: HoleName; readonly key: string; readonly className?: string },
	child: C,
) =>
	h.div
		.key(`hole:${options.hole}:${options.key}`)
		.attr("hidden", "")
		.attr("data-hazel-home", options.hole)
		.children(
			h.div
				.class(options.className ?? "contents")
				.onMount(PlaceInHole({ hole: options.hole }))
				.children(child),
		)
