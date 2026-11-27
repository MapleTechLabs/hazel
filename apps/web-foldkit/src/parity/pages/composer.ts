import type { ComparePage } from "../compare-entry"

/** The channel composer (`@hazel/shared-screens/chat/composer`) under the list of the offline fixture's #general. */
export default {
	flag: "hazel:native:Composer",
	// `generalChannelId` in `apps/ios-hybrid/fixture/snapshot.ts`.
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: '[data-hazel-hole="composer"] > div',
	wide: true,
	steps: [{ waitFor: "text=Off to update the benchmarks with the release build." }],
} satisfies ComparePage
