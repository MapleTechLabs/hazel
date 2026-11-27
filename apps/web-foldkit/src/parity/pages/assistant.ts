import type { ComparePage } from "../compare-entry"

/**
 * The assistant panel over #general, opened on its seeded chat (`apps/ios-hybrid/fixture/pages/assistant.ts`):
 * the toggle's key, the history menu, then the chat. The panel is no route, so the window is compared.
 */
export default {
	flag: "hazel:native:AssistantPanel",
	href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
	island: "[data-ai-panel]",
	wide: true,
	region: "viewport",
	steps: [
		{ press: "ControlOrMeta+j" },
		{ waitFor: '[aria-label="Chat history"]' },
		{ click: '[aria-label="Chat history"]' },
		// The threads' live query starts when the panel opens: wait for the chat's row.
		{ waitFor: "text=Summarize #general" },
		{ click: "text=Summarize #general" },
		{ waitFor: "text=Nobody raised a blocker since Monday." },
	],
} satisfies ComparePage
