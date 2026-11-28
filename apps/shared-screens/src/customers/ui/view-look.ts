/**
 * A saved view's look in the sidebar and its tab (today's `web-foldkit/src/customers/ui/view-look.ts`):
 * its icon, or a dot, tinted by its colour. The built-ins and the two fixed views ship one; a view
 * that sets neither shows a muted dot.
 */
import type * as Customers from "@hazel/domain/customers"
import type { Hazel } from "@hazel/ui/vocabulary/index"

export interface ViewLook {
	readonly icon: Customers.ViewIcon | null
	readonly color: Customers.ViewColor | null
}

/** What the built-ins, "Current customers" (`current`) and "All customers" (`all`) ship with. */
const SHIPPED = {
	current: { icon: null, color: "purple" },
	all: { icon: null, color: "gray" },
	my_customers: { icon: "user", color: null },
	paying: { icon: null, color: "green" },
	trialing: { icon: null, color: "blue" },
	churned: { icon: null, color: "gray" },
} as const satisfies Record<Customers.BuiltInViewKey | "current" | "all", ViewLook>

const isShippedKey = (key: string): key is keyof typeof SHIPPED => Object.hasOwn(SHIPPED, key)

const NONE: ViewLook = { icon: null, color: null }

/** A view's look: its own, else (nothing set) what its key ships with. */
export const lookOf = (key: string, own: ViewLook | null): ViewLook =>
	own !== null && (own.icon !== null || own.color !== null)
		? { icon: own.icon, color: own.color }
		: isShippedKey(key)
			? SHIPPED[key]
			: NONE

/** The look as a glyph: the icon in the view's colour (muted when none), or a dot in it. */
export const viewGlyph = <Msg>(h: Hazel.H<Msg>, look: ViewLook) => {
	const tint = look.color ?? "muted"
	return look.icon === null ? h.icon.dot().tint(tint) : h.icon.name(look.icon).tint(tint)
}
