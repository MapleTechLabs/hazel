import { DEFAULT_SOUND_SETTINGS } from "../notification-sound"
import { defaultThemePreference } from "../theme"
import type { Shared } from "./contract"

/** The root-provided `Shared` fields tests rarely care about; spread into a test's `Shared` literal. */
export const sharedDefaults = {
	isMobile: false,
	theme: { ...defaultThemePreference(), resolved: "light" },
	soundSettings: DEFAULT_SOUND_SETTINGS,
} satisfies Partial<Shared>
