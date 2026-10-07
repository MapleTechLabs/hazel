import { deflateSync } from "node:zlib"
import type { Page } from "playwright"
import { inboxDataset } from "../fixtures/datasets/inbox.ts"
import {
	personalOverflowDataset,
	personalPrefsDataset,
	personalPresenceDataset,
} from "../fixtures/datasets/personal.ts"
import { org, type AreaModule } from "./types.ts"

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})
const crc32 = (bytes: Buffer) => {
	let c = 0xffffffff
	for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}
const pngChunk = (type: string, data: Buffer) => {
	const body = Buffer.concat([Buffer.from(type, "ascii"), data])
	const out = Buffer.alloc(body.length + 8)
	out.writeUInt32BE(data.length, 0)
	body.copy(out, 4)
	out.writeUInt32BE(crc32(body), body.length + 4)
	return out
}

/** A deterministic 96x96 PNG: two vertical colour bands, so the crop area is visible. */
const avatarPng = (() => {
	const size = 96
	const header = Buffer.alloc(13)
	header.writeUInt32BE(size, 0)
	header.writeUInt32BE(size, 4)
	header.set([8, 2, 0, 0, 0], 8)
	const rows = Buffer.concat(
		Array.from({ length: size }, () =>
			Buffer.from([
				0,
				...Array.from({ length: size }, (_, x) =>
					x < size / 2 ? [37, 99, 235] : [249, 115, 22],
				).flat(),
			]),
		),
	)
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(rows)),
		pngChunk("IEND", Buffer.alloc(0)),
	])
})()

const openCropDialog = async (page: Page) => {
	const chooser = page.waitForEvent("filechooser")
	await page.getByRole("button", { name: "Change profile picture" }).click()
	await (await chooser).setFiles({ name: "avatar.png", mimeType: "image/png", buffer: avatarPng })
	await page.getByRole("dialog").getByText("Crop profile picture").waitFor()
}

const settings = `${org}/my-settings`

export const mySettingsArea: AreaModule = {
	datasets: [inboxDataset, personalPrefsDataset, personalOverflowDataset, personalPresenceDataset],
	scenarios: [
		{
			id: "my-settings-profile",
			area: "settings",
			title: "Profile settings",
			path: `${settings}/profile`,
		},
		{
			id: "my-settings-notifications",
			area: "settings",
			title: "Notification preferences",
			path: `${settings}/notifications`,
		},
		// Appearance (my-settings index)
		{
			id: "my-settings-appearance",
			area: "settings",
			title: "Appearance settings",
			path: settings,
			themes: ["light", "dark"],
		},
		{
			id: "my-settings-appearance-mobile",
			area: "settings",
			title: "Appearance settings on mobile",
			path: settings,
			viewports: ["mobile"],
		},
		{
			id: "my-settings-appearance-remix",
			area: "settings",
			title: "Appearance with generated remix options",
			path: settings,
			steps: async (page) => {
				await page.getByRole("button", { name: "Generate" }).click()
				await page
					.getByText("Click generate to create random theme combinations.")
					.waitFor({ state: "detached" })
			},
		},
		{
			id: "my-settings-appearance-display-mode",
			area: "settings",
			title: "Appearance scrolled to display mode",
			path: settings,
			steps: async (page) => {
				await page.getByText("Switch between light and dark modes.").scrollIntoViewIfNeeded()
			},
		},
		// Desktop (web fallback)
		{
			id: "my-settings-desktop",
			area: "settings",
			title: "Desktop settings, web fallback",
			path: `${settings}/desktop`,
			themes: ["light", "dark"],
		},
		{
			id: "my-settings-desktop-mobile",
			area: "settings",
			title: "Desktop settings on mobile",
			path: `${settings}/desktop`,
			viewports: ["mobile"],
		},
		// Linked accounts
		{
			id: "my-settings-linked-accounts",
			area: "settings",
			title: "Linked accounts, Discord not linked",
			path: `${settings}/linked-accounts`,
			themes: ["light", "dark"],
		},
		{
			id: "my-settings-linked-accounts-linked",
			area: "settings",
			title: "Linked accounts, Discord linked",
			path: `${settings}/linked-accounts`,
			dataset: "inbox",
			viewports: ["desktop", "mobile"],
		},
		{
			id: "my-settings-linked-accounts-error",
			area: "settings",
			title: "Linked accounts after a failed Discord link",
			path: `${settings}/linked-accounts?connection_status=error&provider=discord&error_code=access_denied`,
			steps: async (page) => {
				await page.getByText("Failed to link Discord account").waitFor()
			},
		},
		// Profile
		{
			id: "my-settings-profile-responsive",
			area: "settings",
			title: "Profile settings on mobile",
			path: `${settings}/profile`,
			viewports: ["mobile"],
			themes: ["light", "dark"],
		},
		{
			id: "my-settings-profile-avatar-hover",
			area: "settings",
			title: "Profile picture hovered shows the edit overlay",
			path: `${settings}/profile`,
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "Change profile picture" }).hover()
			},
		},
		{
			id: "my-settings-profile-crop-dialog",
			area: "settings",
			title: "Avatar crop dialog after choosing an image",
			path: `${settings}/profile`,
			steps: openCropDialog,
		},
		{
			id: "my-settings-profile-timezone",
			area: "settings",
			title: "Timezone picker filtered and open",
			path: `${settings}/profile`,
			steps: async (page) => {
				await page.getByRole("combobox").click()
				await page.keyboard.press("ControlOrMeta+a")
				await page.keyboard.type("New")
				await page.getByRole("listbox").waitFor()
			},
		},
		{
			id: "my-settings-profile-edited",
			area: "settings",
			title: "Profile with an edited name enables Save",
			path: `${settings}/profile`,
			steps: async (page) => {
				await page.getByRole("textbox").first().fill("Augusta Ada")
			},
		},
		{
			id: "my-settings-profile-invalid",
			area: "settings",
			title: "Profile with an empty last name shows a validation error",
			path: `${settings}/profile`,
			steps: async (page) => {
				await page.getByRole("textbox").nth(1).fill("")
				await page.getByRole("textbox").first().click()
			},
		},
		{
			id: "my-settings-profile-long-names",
			area: "settings",
			title: "Profile settings with a very long name",
			path: `${settings}/profile`,
			dataset: "personal-overflow",
		},
		// Notification preferences
		{
			id: "my-settings-notifications-toggled",
			area: "settings",
			title: "Notification preferences with do-not-disturb and custom quiet hours",
			path: `${settings}/notifications`,
			dataset: "personal-prefs",
			themes: ["light", "dark"],
		},
		{
			id: "my-settings-notifications-sounds-off",
			area: "settings",
			title: "Notification preferences with sounds disabled",
			path: `${settings}/notifications`,
			steps: async (page) => {
				await page.getByRole("switch", { name: "Enable notification sounds" }).click({ force: true })
			},
		},
		{
			id: "my-settings-notifications-mobile",
			area: "settings",
			title: "Notification preferences on mobile",
			path: `${settings}/notifications`,
			viewports: ["mobile"],
		},
	],
}
