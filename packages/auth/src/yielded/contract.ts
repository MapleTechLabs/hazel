import { AuthContract, PasskeyContract } from "@yielded/auth"
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
