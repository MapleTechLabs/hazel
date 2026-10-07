import { defaultThemePreference } from "../theme"
import type { Shared } from "./contract"

/** The root-provided `Shared` fields tests rarely care about; spread into a test's `Shared` literal. */
export const sharedDefaults = {
	isMobile: false,
	theme: { ...defaultThemePreference(), resolved: "light" },
} satisfies Partial<Shared>
