#!/usr/bin/env bun
/**
 * Signs in to a dev or preview api Worker as any email, through `POST /internal/dev/sign-in`
 * (on only while the Worker has `DEV_SIGNIN_SECRET`):
 *
 *   DEV_SIGNIN_SECRET=… bun run dev:sign-in --api http://localhost:3003 --email a@example.com [--name "Ada L"]
 *
 * Prints the user id and the session cookie (name and value). Send the value as the cookie, or as
 * `Authorization: Bearer <value>` for RPC and `/sync`. The secret is read from the env only.
 */
import { Effect, Schema } from "effect"

class DevSignInArgsError extends Schema.TaggedError<DevSignInArgsError>()("DevSignInArgsError", {
	message: Schema.String,
}) {}

class DevSignInHttpError extends Schema.TaggedError<DevSignInHttpError>()("DevSignInHttpError", {
	message: Schema.String,
}) {}

const DevSignInResponse = Schema.Struct({ userId: Schema.String, sessionToken: Schema.String })

const parseArgs = (argv: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const value = (flag: string) => {
			const i = argv.indexOf(flag)
			return i === -1 ? undefined : argv[i + 1]
		}
		const api = (value("--api") ?? "http://localhost:3003").replace(/\/+$/, "")
		const email = value("--email")
		const name = value("--name")
		const secret = process.env.DEV_SIGNIN_SECRET ?? ""
		if (email === undefined) return yield* new DevSignInArgsError({ message: "--email is required" })
		if (secret === "")
			return yield* new DevSignInArgsError({ message: "DEV_SIGNIN_SECRET is not set in the env" })
		return { api, email, name, secret }
	})

export const main = Effect.gen(function* () {
	const { api, email, name, secret } = yield* parseArgs(process.argv.slice(2))
	const response = yield* Effect.tryPromise({
		try: () =>
			fetch(`${api}/internal/dev/sign-in`, {
				method: "POST",
				headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
				body: JSON.stringify(name === undefined ? { email } : { email, name }),
			}),
		catch: (cause) => new DevSignInHttpError({ message: `${api} is unreachable: ${String(cause)}` }),
	})
	if (!response.ok) {
		const text = yield* Effect.promise(() => response.text())
		return yield* new DevSignInHttpError({
			message:
				response.status === 404
					? `${api} answered 404: DEV_SIGNIN_SECRET is unset on the Worker or does not match`
					: `${api} answered ${response.status}: ${text}`,
		})
	}
	const body = yield* Effect.tryPromise({
		try: () => response.json(),
		catch: () => new DevSignInHttpError({ message: "The response is not JSON" }),
	}).pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(DevSignInResponse)),
		Effect.catchTag("SchemaError", () =>
			Effect.fail(new DevSignInHttpError({ message: "Unexpected response shape" })),
		),
	)
	const [cookie = ""] = response.headers.getSetCookie()
	const cookieName = cookie.slice(0, cookie.indexOf("="))
	console.log(`userId:       ${body.userId}`)
	console.log(`cookie name:  ${cookieName}`)
	console.log(`cookie value: ${body.sessionToken}`)
	console.log(`set-cookie:   ${cookie}`)
})

const report = (error: { readonly message: string }) =>
	Effect.sync(() => {
		console.error(error.message)
		process.exitCode = 1
	})

if (import.meta.main) {
	Effect.runPromise(main.pipe(Effect.catchTags({ DevSignInArgsError: report, DevSignInHttpError: report })))
}
