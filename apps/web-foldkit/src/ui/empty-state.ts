import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { emptyStateStyles } from "~/components/ui/empty-state.styles"
import { iconTile } from "./icon-tile"

/** Port of `components/ui/empty-state.tsx`. `icon` receives the legacy icon className. */
export const emptyState = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly title: string
		readonly icon?: (className: string) => Html
		readonly description?: string
		/** The action slot's children (legacy `action`; a FileTrigger renders a button and an input). */
		readonly action?: Html | ReadonlyArray<Html>
		/**
		 * Announce the state when it appears: `alert` for a failure the person is waiting on (a load
		 * or a preview that failed), `status` for a quiet change. Omit for a state that is just there.
		 */
		readonly role?: "alert" | "status"
		readonly className?: string
	},
): Html =>
	h.div(
		[
			...(options.role === undefined ? [] : [h.Role(options.role)]),
			h.Class(twMerge(emptyStateStyles.root, options.className)),
		],
		[
			...(options.icon
				? [
						iconTile(
							h,
							{ className: emptyStateStyles.iconWrapper },
							options.icon(emptyStateStyles.icon),
						),
					]
				: []),
			h.h3([h.Class(emptyStateStyles.title)], [options.title]),
			...(options.description
				? [h.p([h.Class(emptyStateStyles.description)], [options.description])]
				: []),
			...(options.action
				? [
						h.div(
							[h.Class(emptyStateStyles.action)],
							globalThis.Array.isArray(options.action) ? [...options.action] : [options.action],
						),
					]
				: []),
		],
	)
