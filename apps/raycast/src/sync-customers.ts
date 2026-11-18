/**
 * Background refresh (every 10 minutes once enabled): catches each of the user's organizations'
 * customer lists up to the API and saves them, so "Search Customers" opens on a fresh list. Run by
 * hand, it may sign in and reports what it synced.
 */
import { environment, LaunchType, showHUD } from "@raycast/api"
import { accessToken, SignInRequiredError } from "./lib/auth"
import { apiUrl } from "./lib/config"
import type { Organization } from "./lib/models"
import { call } from "./lib/rpc"
import { CloseCode, loadState, openCustomersSync, saveState } from "./lib/sync"

/** Longest a catch-up may take before the run gives up on that organization. */
const TIMEOUT_MS = 30_000

/** Catches `organizationId` up; answers its customer count, or `null` without a Customers area. */
const syncOrganization = (api: string, organizationId: string, token: string) =>
	new Promise<number | null>((resolve, reject) => {
		let state = loadState(api, organizationId)
		const finish = (count: number | null) => {
			clearTimeout(timer)
			session.close()
			resolve(count)
		}
		const session = openCustomersSync({
			api,
			organizationId,
			token,
			state,
			onCommit: (next) => {
				state = next
				saveState(api, organizationId, next)
			},
			onReady: () => finish(Object.keys(state.accounts).length),
			onClose: (code) => {
				clearTimeout(timer)
				if (code === CloseCode.Forbidden || code === CloseCode.NotFound) resolve(null)
				else reject(new Error(`The sync socket closed (${code})`))
			},
		})
		const timer = setTimeout(() => {
			session.close()
			reject(new Error("The sync timed out"))
		}, TIMEOUT_MS)
	})

export default async function Command() {
	const interactive = environment.launchType === LaunchType.UserInitiated
	const api = apiUrl()
	try {
		const { organizations } = await call<{ organizations: ReadonlyArray<Organization> }>(
			"customers.organizations",
			{},
			{ interactive },
		)
		const token = await accessToken({ interactive })
		let total = 0
		for (const organization of organizations) {
			total += (await syncOrganization(api, organization.id, token)) ?? 0
		}
		if (interactive) await showHUD(`Synced ${total} customers`)
	} catch (error) {
		// In the background a signed-out extension just waits for the next sign-in.
		if (!interactive && error instanceof SignInRequiredError) return
		if (interactive)
			await showHUD(`Could not sync: ${error instanceof Error ? error.message : String(error)}`)
		else throw error
	}
}
