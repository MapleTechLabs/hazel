import type { Shared } from "./contract"

/** The root-provided `Shared` fields tests rarely care about; spread into a test's `Shared` literal. */
export const sharedDefaults = {
	isMobile: false,
} satisfies Partial<Shared>
