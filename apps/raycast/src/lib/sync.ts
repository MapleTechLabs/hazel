/**
 * What the extension keeps in Raycast's `Cache`, so a list opens instantly: each org's customer
 * list (accounts, signals and channel links, trimmed to what it shows; `catch-up.ts` fills it), when
 * it last caught up, and the organizations.
 */
import { Cache } from "@raycast/api"
import type { Organization } from "./models"
import type { CustomersStore } from "./catch-up"
import { type CustomersState, EMPTY_STATE } from "./protocol"

export { type CustomersState, EMPTY_STATE } from "./protocol"

/** Bump the version when the kept fields change: older lists then sync from a fresh snapshot. */
const cache = new Cache({ capacity: 50 * 1024 * 1024, namespace: "customers-v1" })
const cacheKey = (api: string, organizationId: string) => `${api}|${organizationId}`

export const loadState = (api: string, organizationId: string): CustomersState => {
	const json = cache.get(cacheKey(api, organizationId))
	// SAFETY: only `saveState` writes this key, with a `CustomersState`.
	return json === undefined ? EMPTY_STATE : (JSON.parse(json) as CustomersState)
}

export const saveState = (api: string, organizationId: string, state: CustomersState) =>
	cache.set(cacheKey(api, organizationId), JSON.stringify(state))

/** Forgets every saved customer list, and `useCachedPromise`'s saved results (signing out). */
export const clearSavedData = () => {
	cache.clear()
	new Cache().clear()
}

/** Forgets one org's saved list (it has no Customers area for this user any more). */
export const forgetOrganization = (api: string, organizationId: string) => {
	cache.remove(cacheKey(api, organizationId))
	cache.remove(`${cacheKey(api, organizationId)}|syncedAt`)
}

/** The organizations last listed (`customers.organizations`), for an instant dropdown. */
export const loadOrganizations = (api: string): ReadonlyArray<Organization> | undefined => {
	const json = cache.get(`${api}|organizations`)
	// SAFETY: only `saveOrganizations` writes this key, with an `Organization` array.
	return json === undefined ? undefined : (JSON.parse(json) as ReadonlyArray<Organization>)
}

export const saveOrganizations = (api: string, organizations: ReadonlyArray<Organization>) =>
	cache.set(`${api}|organizations`, JSON.stringify(organizations))

/** When the org's list last caught up (epoch ms), if ever. */
export const lastSyncedAt = (api: string, organizationId: string): number | undefined => {
	const value = cache.get(`${cacheKey(api, organizationId)}|syncedAt`)
	return value === undefined ? undefined : Number(value)
}

export const markSynced = (api: string, organizationId: string, at: number) =>
	cache.set(`${cacheKey(api, organizationId)}|syncedAt`, String(at))

/** The cache as the catch-up's store, for `api`. */
export const customersStore = (api: string): CustomersStore => ({
	load: (organizationId) => loadState(api, organizationId),
	save: (organizationId, state) => saveState(api, organizationId, state),
	markSynced: (organizationId, at) => markSynced(api, organizationId, at),
})
