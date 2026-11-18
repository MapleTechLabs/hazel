import { showToast, Toast } from "@raycast/api"
import { useCallback, useEffect, useRef, useState } from "react"
import { accessToken, isSignedIn } from "./auth"
import { apiUrl } from "./config"
import type { Organization } from "./models"
import { CloseCode } from "./protocol"
import { catchUp, SyncClosedError } from "./catch-up"
import { call } from "./rpc"
import {
	clearSavedData,
	type CustomersState,
	customersStore,
	EMPTY_STATE,
	forgetOrganization,
	lastSyncedAt,
	loadOrganizations,
	loadState,
	markSynced,
	saveOrganizations,
} from "./sync"

/** An org synced this recently is not synced again on open (`syncNow` still does). */
const DEBOUNCE_MS = 5 * 60 * 1000

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The user's organizations and the chosen one's customers, saved data first (only while signed
 * in: Raycast's own "Log out" leaves it behind, so it is dropped then).
 *
 * On open the organizations are listed again, and the chosen org catches up from Hazel's store
 * unless it did within `DEBOUNCE_MS`; so does an org when it is chosen. Only the chosen org syncs,
 * as on the web: opening an org's customers stream sets up its Customers area. `syncNow` lists the
 * organizations and catches the chosen org up regardless, preempting a sync in progress.
 */
export const useCustomers = (chosenId: string | undefined) => {
	const api = apiUrl()
	const [organizations, setOrganizations] = useState<ReadonlyArray<Organization> | undefined>(undefined)
	const [state, setState] = useState<CustomersState>(EMPTY_STATE)
	const [isListing, setIsListing] = useState(true)
	const [isSyncing, setIsSyncing] = useState(false)
	const [syncedAt, setSyncedAt] = useState<number | undefined>(undefined)
	const [failure, setFailure] = useState<string | undefined>(undefined)
	/** Orgs without a Customers area for this user (their stream refused them). */
	const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set())
	const organization = organizations?.find((org) => org.id === chosenId) ?? organizations?.[0]
	const running = useRef<AbortController | undefined>(undefined)

	const fail = async (error: unknown) => {
		setFailure(errorText(error))
		await showToast({
			style: Toast.Style.Failure,
			title: "Could not sync customers",
			message: errorText(error),
		})
	}

	const syncOne = async (org: Organization, signal: AbortSignal, forceRefresh = false): Promise<void> => {
		try {
			const result = await catchUp({
				api,
				store: customersStore(api),
				organizationId: org.id,
				token: await accessToken({ forceRefresh }),
				signal,
				onCommit: setState,
			})
			if (result === null) {
				// Refused: nothing kept, and not asked again before the debounce passes.
				forgetOrganization(api, org.id)
				markSynced(api, org.id, Date.now())
			}
			setUnavailable((current) => {
				const next = new Set(current)
				if (result === null) next.add(org.id)
				else next.delete(org.id)
				return next
			})
			setState(result ?? EMPTY_STATE)
			setSyncedAt(lastSyncedAt(api, org.id))
		} catch (error) {
			// The token expired or was revoked: refresh it and try once more.
			if (error instanceof SyncClosedError && error.code === CloseCode.Reauth && !forceRefresh)
				return syncOne(org, signal, true)
			throw error
		}
	}

	const syncOrganization = async (org: Organization, force: boolean) => {
		if (!force && Date.now() - (lastSyncedAt(api, org.id) ?? 0) < DEBOUNCE_MS) return
		running.current?.abort()
		const controller = new AbortController()
		running.current = controller
		setIsSyncing(true)
		setFailure(undefined)
		try {
			await syncOne(org, controller.signal)
		} catch (error) {
			if (!controller.signal.aborted) await fail(error)
		} finally {
			if (running.current === controller) {
				running.current = undefined
				setIsSyncing(false)
			}
		}
	}

	const listOrganizations = useCallback(async () => {
		setIsListing(true)
		try {
			const { organizations: listed } = await call<{ organizations: ReadonlyArray<Organization> }>(
				"customers.organizations",
				{},
			)
			// An org the user left keeps nothing on disk.
			for (const gone of loadOrganizations(api) ?? [])
				if (!listed.some((org) => org.id === gone.id)) forgetOrganization(api, gone.id)
			saveOrganizations(api, listed)
			setOrganizations(listed)
		} catch (error) {
			await fail(error)
		} finally {
			setIsListing(false)
		}
	}, [api])

	useEffect(() => {
		void (async () => {
			if (await isSignedIn()) setOrganizations(loadOrganizations(api))
			else clearSavedData()
			await listOrganizations()
		})()
		return () => running.current?.abort()
	}, [api])

	// The chosen org: its saved list at once, then a catch-up unless it had one within the debounce.
	useEffect(() => {
		if (organization === undefined) return
		running.current?.abort()
		setState(loadState(api, organization.id))
		setSyncedAt(lastSyncedAt(api, organization.id))
		void syncOrganization(organization, false)
	}, [api, organization?.id])

	return {
		organizations,
		organization,
		state,
		isSyncing: isListing || isSyncing,
		syncedAt,
		failure,
		isUnavailable: organization !== undefined && unavailable.has(organization.id),
		syncNow: async () => {
			await listOrganizations()
			if (organization !== undefined) await syncOrganization(organization, true)
		},
	}
}
