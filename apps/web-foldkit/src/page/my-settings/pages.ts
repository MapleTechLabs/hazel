import * as MySettingsAppearance from "./appearance"
import * as MySettingsDesktop from "./desktop"
import * as MySettingsKeybinds from "./keybinds"
import * as MySettingsLinkedAccounts from "./linked-accounts"
import * as MySettingsNotifications from "./notifications"
import * as MySettingsProfile from "./profile"

/** The user's own settings pages: their own chunk, loaded with the first of their routes (`../registry.ts`). */
export const pages = [
	MySettingsAppearance.page,
	MySettingsDesktop.page,
	MySettingsKeybinds.page,
	MySettingsLinkedAccounts.page,
	MySettingsNotifications.page,
	MySettingsProfile.page,
]
