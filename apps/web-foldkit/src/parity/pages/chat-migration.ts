import type { ComparePage } from "../compare-entry"

/**
 * The chat migration wizard walked over Slack to its progress step, in the chat sync settings
 * dialog. The hazel wizard (`shared-screens/src/chat/migration`) mounts there with PS3; until then
 * only today's side draws, and these strips are its baseline.
 */
export default {
	flag: "hazel:native:ChatMigration",
	href: "/hazel/settings/chat-sync",
	island: "[data-hz-key=chat-migration]",
	wide: true,
	region: "viewport",
	steps: [
		{ click: 'button:has-text("Import from Slack or Discord"):visible' },
		{
			click: '[data-testid=chat-migration-provider-slack], [data-hz=choiceGroup] [role=radio]:has-text("Import from Slack")',
		},
		{ waitFor: 'text="Choose what to bring from Acme Slack"' },
		{ click: '[data-testid=chat-migration-go], [data-hz=button]:has-text("Migrate 3 channels")' },
		{ waitFor: 'text="You\'re all set"' },
	],
} satisfies ComparePage
