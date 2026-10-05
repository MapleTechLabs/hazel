import { Atom } from "effect/reactivity"
import type { ChannelSectionId } from "@hazel/schema"
import { Schema } from "effect"
import { platformStorageRuntime } from "~/lib/platform-storage"

/**
 * Schema for collapsed sections state
 * Maps section IDs to their collapsed state
 */
const CollapsedSectionsSchema = Schema.Record(Schema.String, Schema.Boolean)

/**
 * Atom that stores collapsed state for all sections
 * Persisted to localStorage as "section_collapsed_state"
 */
export const collapsedSectionsAtom = Atom.kvs({
	runtime: platformStorageRuntime,
	key: "section_collapsed_state",
	schema: Schema.toCodecIso(CollapsedSectionsSchema),
	defaultValue: () => ({}) as Record<string, boolean>,
})

/**
 * Atom family that returns the collapsed state for a specific section
 */
export const sectionCollapsedAtomFamily = Atom.family((sectionId: ChannelSectionId | "default" | "dms") =>
	Atom.make((get) => {
		const collapsedSections = get(collapsedSectionsAtom)
		return collapsedSections[sectionId] ?? false
	}),
)
