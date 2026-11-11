/**
 * @module Desktop autostart functionality
 * @platform desktop
 * @description Enable/disable automatic app launch at system login
 */

import { getTauriAutostart } from "@hazel/desktop/bridge"

export async function enableAutostart(): Promise<boolean> {
	const autostart = getTauriAutostart()
	if (!autostart) return false
	await autostart.enable()
	return true
}

export async function disableAutostart(): Promise<boolean> {
	const autostart = getTauriAutostart()
	if (!autostart) return false
	await autostart.disable()
	return true
}

export async function isAutostartEnabled(): Promise<boolean> {
	const autostart = getTauriAutostart()
	if (!autostart) return false
	return await autostart.isEnabled()
}
