import { AuthContract, BrowserLoginContract, OperationHttp, PasskeyContract } from "@yielded/auth"
import { Schema } from "effect"

// Browser-safe shared contract. No provider configuration, keys or persistence here.

export const Registration = Schema.Struct({
	firstName: Schema.NonEmptyString.check(Schema.isMaxLength(100)),
	lastName: Schema.String.check(Schema.isMaxLength(100)),
})

export const Claims = Schema.Struct({
	displayName: Schema.String,
})

const passkeys = PasskeyContract.makeManagement("hazel/passkeys").operations

export const HazelAuthApi = AuthContract.make("hazel", {
	claims: Claims,
	actions: (sessions) => {
		const passkey = PasskeyContract.make("hazel/passkey", sessions).operations

		return {
			signIn: AuthContract.oauthSignIn(),
			completeSignIn: AuthContract.oauthCompleteSignIn(sessions),
			// authenticate: the first confirmed registration issues the session directly.
			register: AuthContract.oauthRegister(sessions, Registration, { authenticate: true }),
			listLinkedAccounts: AuthContract.oauthListLinkedAccounts({ strategy: "accounts" }),
			passkeySignIn: AuthContract.fromOperation(passkey.Begin, {
				strategy: "passkey",
				method: "signIn",
			}),
			completePasskeySignIn: AuthContract.fromOperation(passkey.Complete, {
				strategy: "passkey",
				method: "completeSignIn",
				requestFields: { bindingCredential: "request-binding" },
				subject: {
					fromSuccess: (result) =>
						result._tag === "Authenticated" ? result.session.subjectId : undefined,
				},
			}),
			enrollPasskey: AuthContract.fromOperation(passkeys.Begin, { strategy: "passkeys" }),
			completePasskeyEnrollment: AuthContract.fromOperation(passkeys.Complete, {
				strategy: "passkeys",
				requestFields: { bindingCredential: "request-binding" },
			}),
			listPasskeys: AuthContract.fromOperation(passkeys.List, {
				strategy: "passkeys",
				mode: "query",
			}),
		}
	},
})

/** The desktop app, signing in through the system browser (`BrowserLogin`). */
export const desktopClient = {
	clientId: "desktop",
	displayName: "Hazel Desktop",
	/**
	 * A deep link scheme the app registers (apps/desktop tauri.conf.json). The library accepts
	 * only reverse-domain custom schemes, so it is the app identifier, not `hazel:`.
	 */
	returnUrl: "com.hazel.app://auth/callback",
	browserSession: "confirm",
} as const

/** The browser-to-desktop handoff: the web app authorizes, the desktop app exchanges. */
export const desktopLogin = BrowserLoginContract.make(
	HazelAuthApi.sessions.moduleId,
	HazelAuthApi.sessions.Session,
	{
		basePath: "/auth/browser-login",
	},
)

/** The desktop app's own session: who it is signed in as, and signing out. */
export const nativeSession = OperationHttp.make({
	session: OperationHttp.route(HazelAuthApi.sessions.operations.Verify, {
		path: "/auth/native/session",
		credentials: { credential: "session" },
		allowInternal: true,
	}),
	signOut: OperationHttp.route(HazelAuthApi.sessions.operations.SignOut, {
		path: "/auth/native/sign-out",
		credentials: { credential: "session" },
		allowInternal: true,
	}),
})

/** Headers that carry the desktop app's credentials instead of cookies. */
export const nativeHeaders = {
	modeHeader: "x-auth-mode",
	requestPrefix: "x-auth-request-",
	responsePrefix: "x-auth-response-",
	/** Marks requests from the desktop app; admission only, not authentication. */
	clientHeader: "x-auth-client",
	clientValue: "hazel-desktop",
} as const
