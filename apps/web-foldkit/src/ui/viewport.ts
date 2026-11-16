/** `useSidebar().isMobile`: the viewport the phone layout is for (the shell, sheets for menus). */
export const MOBILE_QUERY = "(max-width: 767px)"

/** Whether the viewport is a phone's right now, for commands that cannot read `Shared.isMobile`. */
export const isMobileViewport = (): boolean => globalThis.matchMedia?.(MOBILE_QUERY).matches ?? false
