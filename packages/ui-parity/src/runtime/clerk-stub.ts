/**
 * Browser-side stand-in for clerk-js, installed via `page.addInitScript` before the
 * app boots. `@clerk/react` sees `window.Clerk.loaded === true` and skips downloading
 * clerk-js / clerk-ui entirely, so auth is deterministic and offline.
 *
 * Serialized into the page with `Function.prototype.toString`, so it must be
 * self-contained (no imports, no closures over module scope).
 */
export interface ClerkStubIdentity {
	readonly clerkUserId: string
	readonly email: string
	readonly firstName: string
	readonly lastName: string
	readonly imageUrl: string
	readonly clerkOrgId: string | null
}

export const installClerkStub = (identity: ClerkStubIdentity) => {
	const noop = () => {}
	const asyncNoop = async () => {}
	const user = {
		id: identity.clerkUserId,
		firstName: identity.firstName,
		lastName: identity.lastName,
		fullName: `${identity.firstName} ${identity.lastName}`,
		imageUrl: identity.imageUrl,
		hasImage: true,
		primaryEmailAddress: { emailAddress: identity.email },
		emailAddresses: [{ emailAddress: identity.email }],
		externalAccounts: [],
		organizationMemberships: identity.clerkOrgId
			? [{ organization: { id: identity.clerkOrgId }, role: "org:admin", permissions: [] }]
			: [],
		publicMetadata: {},
		unsafeMetadata: {},
		reload: asyncNoop,
		update: asyncNoop,
	}
	const organization = identity.clerkOrgId ? { id: identity.clerkOrgId, name: "Org", slug: "org" } : null
	const session = {
		id: "sess_parity",
		status: "active",
		user,
		lastActiveOrganizationId: identity.clerkOrgId,
		factorVerificationAge: null,
		lastActiveToken: {
			getRawString: () => "parity-token",
			jwt: {
				claims: {
					sub: identity.clerkUserId,
					sid: "sess_parity",
					org_id: identity.clerkOrgId ?? undefined,
				},
			},
		},
		getToken: async () => "parity-token",
		checkAuthorization: () => true,
		touch: asyncNoop,
	}
	const client = {
		sessions: [session],
		signedInSessions: [session],
		activeSessions: [session],
		lastActiveSessionId: session.id,
	}
	const resources = { client, session, user, organization }
	const listeners = new Set<(r: typeof resources) => void>()

	const base: Record<string, unknown> = {
		loaded: true,
		status: "ready",
		version: "parity-stub",
		sdkMetadata: { name: "parity-stub", version: "0" },
		instanceType: "development",
		frontendApi: "parity.clerk.invalid",
		publishableKey: "pk_test_parity",
		isSatellite: false,
		isSignedIn: true,
		client,
		session,
		user,
		organization,
		telemetry: { record: noop },
		load: asyncNoop,
		__internal_lastEmittedResources: resources,
		addListener: (listener: (r: typeof resources) => void, options?: { skipInitialEmit?: boolean }) => {
			listeners.add(listener)
			if (!options?.skipInitialEmit) listener(resources)
			return () => listeners.delete(listener)
		},
		on: noop,
		off: noop,
		__internal_updateProps: noop,
		__internal_setStatus: noop,
		setActive: asyncNoop,
		signOut: asyncNoop,
		redirectToSignIn: asyncNoop,
		buildUrlWithAuth: (url: string) => url,
		buildSignInUrl: () => "/sign-in",
		buildSignUpUrl: () => "/sign-up",
		buildAfterSignOutUrl: () => "/",
		getOrganizationMemberships: async () => ({ data: [], total_count: 0 }),
		// Mount helpers for prebuilt components render nothing in parity runs.
		mountSignIn: noop,
		unmountSignIn: noop,
		mountSignUp: noop,
		unmountSignUp: noop,
		mountCreateOrganization: noop,
		unmountCreateOrganization: noop,
	}

	// Clerk's React layer calls a long tail of internal/UI methods (`__internal_*`,
	// `mountUserButton`, `openSignIn`, ...). None of them affect rendering, so they no-op.
	const isNoopMethod = (prop: string) =>
		/^(__internal_|mount|unmount|open|close|navigate|handle)/.test(prop)

	const unknownAccesses = new Set<string>()
	;(window as unknown as { __parityClerkUnknown: Set<string> }).__parityClerkUnknown = unknownAccesses
	;(window as unknown as { Clerk: unknown }).Clerk = new Proxy(base, {
		get(target, prop, receiver) {
			if (typeof prop === "string" && prop !== "then" && !(prop in target)) {
				if (isNoopMethod(prop)) return asyncNoop
				unknownAccesses.add(prop)
			}
			return Reflect.get(target, prop, receiver)
		},
	})
}
