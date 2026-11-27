import type { Html, HtmlBuilder } from "foldkit/html"
import { button, buttonClassName } from "../ui/button"
import { emptyState } from "../ui/empty-state"
import { progressBar, progressBarTrack } from "../ui/progress-bar"

/** The app's full-page states: loading, an error it cannot get past, an organization it cannot see. */

/**
 * `components/loader.tsx`: the full-page loader `_app` shows while auth or the user loads.
 * With `onReload`, loading has stalled: a note and a reload button show under it, and the
 * loader keeps waiting, so data that arrives late still replaces it.
 */
export const appLoader = <Message>(h: HtmlBuilder<Message>, onReload?: Message): Html =>
	h.div(
		// The last screen's paint stays up while this shows (`app/paint.ts`).
		[
			h.Class("flex h-screen flex-col items-center justify-center gap-6"),
			h.Attribute("data-paint", "loader"),
		],
		[
			h.div(
				[h.Class("flex w-full max-w-sm flex-col items-center gap-4")],
				[
					h.div(
						[
							h.Class(
								"mask-radial-at-center mask-radial-from-black mask-radial-to-transparent relative aspect-square w-full",
							),
						],
						[
							h.img([
								h.Attribute("src", "/images/squirrle_window.webp"),
								h.Attribute("alt", "squirrel"),
								h.Class(
									"mask-size-[110%_90%] mask-linear-to-r mask-from-black mask-to-transparent mask-center mask-no-repeat mask-[url(/images/image-mask.webp)] h-full w-full rounded-md bg-center bg-cover bg-no-repeat object-cover",
								),
							]),
						],
					),
					progressBar(h, { isIndeterminate: true, ariaLabel: "Loading" }, [
						progressBarTrack(h, { isIndeterminate: true }),
					]),
				],
			),
			h.p(
				[h.Class("font-bold font-mono text-xl")],
				[
					"Loading",
					h.span(
						[h.Class("inline-block")],
						[
							"animate-bounce [animation-delay:0s]",
							"animate-bounce [animation-delay:0.2s]",
							"animate-bounce [animation-delay:0.4s]",
						].map((className) => h.span([h.Class(className)], ["."])),
					),
				],
			),
			...(onReload === undefined ? [] : [stalledNotice(h, onReload)]),
		],
	)

const stalledNotice = <Message>(h: HtmlBuilder<Message>, onReload: Message): Html =>
	h.div(
		[h.Class("flex flex-col items-center gap-3 text-center"), h.Role("status")],
		[
			h.p([h.Class("text-muted-fg text-sm")], ["This is taking longer than usual. Still trying…"]),
			button(h, { intent: "outline", size: "sm", onPress: onReload }, ["Reload"]),
		],
	)

/**
 * A full-page error the app cannot get past on its own (the API did not answer, `user.me` failed):
 * what happened, and a way to try again.
 */
export const appError = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{ title: string; description: string | undefined; onRetry: Message }>,
): Html =>
	h.div(
		[h.Class("flex h-screen items-center justify-center p-6"), h.Role("alert")],
		[
			emptyState(h, {
				title: options.title,
				...(options.description === undefined ? {} : { description: options.description }),
				action: button(h, { intent: "primary", onPress: options.onRetry }, ["Try again"]),
			}),
		],
	)

/** The route names an organization the user cannot see: it does not exist or they are not a member. */
export const organizationNotFound = <Message>(h: HtmlBuilder<Message>, orgSlug: string): Html =>
	h.div(
		[h.Class("flex h-screen items-center justify-center p-6")],
		[
			emptyState(h, {
				title: "Workspace not found",
				description: `The workspace “${orgSlug}” does not exist, or you are not a member of it.`,
				action: h.a(
					[h.Attribute("href", "/"), h.Class(buttonClassName({ intent: "primary" }))],
					["Go to your workspace"],
				),
			}),
		],
	)
