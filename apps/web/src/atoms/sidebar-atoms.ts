import { Atom } from "effect/reactivity"
import { Schema } from "effect"
import { platformStorageRuntime } from "~/lib/platform-storage"

/**
 * Sidebar state type
 */
export type SidebarState = "expanded" | "collapsed"

/**
 * Atom that stores whether the sidebar is open (desktop)
 * Persisted to localStorage as "sidebar_state" for backwards compatibility
 */
export const sidebarOpenAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "sidebar_state",
	schema: Schema.toCodecIso(Schema.NullOr(Schema.Boolean)),
	defaultValue: () => true,
})

/**
 * Atom that stores whether the mobile sidebar is open
 * Not persisted, resets on page load
 */
export const sidebarOpenMobileAtom = Atom.make<boolean>(false).pipe(Atom.keepAlive)

/**
 * Derived atom that returns the sidebar state ("expanded" or "collapsed")
 */
export const sidebarStateAtom = Atom.make((get) => {
	const isOpen = get(sidebarOpenAtom)
	return isOpen ? ("expanded" as const) : ("collapsed" as const)
}).pipe(Atom.keepAlive)

/**
 * Helper function to toggle the desktop sidebar
 */
export const toggleSidebar = () => {
	Atom.batch(() => {
		return Atom.update(sidebarOpenAtom, (open) => !open)
	})
}

/**
 * Helper function to toggle the mobile sidebar
 */
export const toggleMobileSidebar = () => {
	Atom.batch(() => {
		return Atom.update(sidebarOpenMobileAtom, (open) => !open)
	})
}

/**
 * Helper function to set the sidebar state
 */
export const setSidebarOpen = (open: boolean) => {
	Atom.batch(() => {
		return Atom.set(sidebarOpenAtom, open)
	})
}

/**
 * Helper function to set the mobile sidebar state
 */
export const setMobileSidebarOpen = (open: boolean) => {
	Atom.batch(() => {
		return Atom.set(sidebarOpenMobileAtom, open)
	})
}
