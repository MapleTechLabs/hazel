import * as MySettingsAgents from "./agents"
import * as MySettingsKeybinds from "./keybinds"
import * as MySettingsLinkedAccounts from "./linked-accounts"
import * as MySettingsProfile from "./profile"

/** The user's own settings pages (Appearance, Notifications and Desktop are native, `root/native-pages.ts`): their own chunk, loaded with the first of their routes (`../registry.ts`). */
export const pages = [
	MySettingsAgents.page,
	MySettingsKeybinds.page,
	MySettingsLinkedAccounts.page,
	MySettingsProfile.page,
]
