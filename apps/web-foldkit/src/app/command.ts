import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { load, pushUrl, replaceUrl } from "foldkit/navigation"
import { HazelRpc } from "../rpc"
import { applyTheme, ResolvedTheme } from "../theme"
import { signOut } from "./clerk"
import { Message } from "./message"

export const NavigateInternal = Command.define("NavigateInternal", {
	args: { url: Schema.String },
	messages: [Message.CompletedNavigateInternal],
	execute: ({ url }) => pushUrl(url).pipe(Effect.as(Message.CompletedNavigateInternal())),
})

/** Redirects replace the history entry, so Back never lands on a page that forwards again. */
export const ReplaceUrl = Command.define("ReplaceUrl", {
	args: { url: Schema.String },
	messages: [Message.CompletedReplaceUrl],
	execute: ({ url }) => replaceUrl(url).pipe(Effect.as(Message.CompletedReplaceUrl())),
})

export const LoadExternal = Command.define("LoadExternal", {
	args: { href: Schema.String },
	messages: [Message.CompletedLoadExternal],
	execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

export const ApplyTheme = Command.define("ApplyTheme", {
	args: { theme: ResolvedTheme },
	messages: [Message.CompletedApplyTheme],
	execute: ({ theme }) => applyTheme(theme).pipe(Effect.as(Message.CompletedApplyTheme())),
})

export const SignOut = Command.define("SignOut", {
	args: {},
	messages: [Message.CompletedSignOut],
	execute: () => signOut.pipe(Effect.as(Message.CompletedSignOut())),
})

export const FetchCurrentUser = Command.define("FetchCurrentUser", {
	args: {},
	messages: [Message.SucceededFetchCurrentUser, Message.FailedFetchCurrentUser],
	execute: () =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const user = yield* client("user.me", undefined)
			return Message.SucceededFetchCurrentUser({
				user: {
					id: user.id,
					firstName: user.firstName ?? "",
					lastName: user.lastName ?? "",
					email: user.email,
					avatarUrl: user.avatarUrl ?? null,
					isOnboarded: user.isOnboarded,
					organizationId: user.organizationId ?? null,
				},
			})
		}).pipe(
			Effect.catch((error) =>
				Effect.succeed(Message.FailedFetchCurrentUser({ reason: String(error) })),
			),
		),
})
