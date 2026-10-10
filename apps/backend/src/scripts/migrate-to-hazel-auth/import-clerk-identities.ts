/**
 * Carries users over from Clerk to Hazel sign-in: links each user's GitHub and Google
 * accounts (as recorded by Clerk) to their existing Hazel user, so their first sign-in on
 * the new system lands in their own account.
 *
 * Dry run by default: reads Clerk and the database, writes nothing, and prints how users
 * split up. `--apply` writes the links. Safe to re-run (linking is idempotent), so it can
 * run nightly until the cutover to pick up new Clerk sign-ups.
 *
 * Usage:
 *   CLERK_SECRET_KEY=… DATABASE_URL=… bun run src/scripts/migrate-to-hazel-auth/import-clerk-identities.ts
 *   CLERK_SECRET_KEY=… DATABASE_URL=… bun run src/scripts/migrate-to-hazel-auth/import-clerk-identities.ts --apply
 *
 * Output: a summary, and ./exports/hazel-auth-import-report.json with the users in each
 * group (it contains emails: keep it local).
 *
 * Groups:
 * - linked: has GitHub or Google in Clerk. Imported; signs straight in.
 * - emailOnly: no GitHub or Google. Signs in with GitHub or Google whose verified email
 *   matches theirs (linked automatically at sign-in), unless the email is shared.
 * - emailShared: email-only and another active user has the same email, so sign-in can't
 *   match it automatically. Needs a manual link.
 * - conflicts: the provider account is already linked to a different Hazel user.
 * - missingInHazel / missingInClerk: present on one side only.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { createClerkClient, type User as ClerkUser } from "@clerk/backend"
import { PgClient } from "@effect/sql-pg"
import { CryptoLive, isProvider, linkIdentity, type Provider } from "@hazel/auth/server"
import { Config, Effect, Redacted } from "effect"
import { SqlClient } from "effect/sql"

const apply = process.argv.includes("--apply")
const REPORT_PATH = "./exports/hazel-auth-import-report.json"
const PAGE_SIZE = 500

type HazelUser = { id: string; externalId: string; email: string; deleted: boolean; userType: string }
type Entry = { hazelUserId?: string; clerkUserId?: string; email?: string; detail?: string }

const listClerkUsers = (secretKey: string) =>
	Effect.tryPromise(async () => {
		const clerk = createClerkClient({ secretKey })
		const users: Array<ClerkUser> = []
		for (let offset = 0; ; offset += PAGE_SIZE) {
			const page = await clerk.users.getUserList({ limit: PAGE_SIZE, offset, orderBy: "+created_at" })
			users.push(...page.data)
			if (page.data.length < PAGE_SIZE) return users
		}
	})

/** Verified GitHub and Google accounts; Clerk names providers `oauth_github` / `oauth_google`. */
const providerAccounts = (user: ClerkUser) =>
	user.externalAccounts.flatMap((account) => {
		const provider = account.provider.replace(/^oauth_/, "")
		if (!isProvider(provider) || account.providerUserId === "") return []
		if (account.verification !== null && account.verification.status !== "verified") return []
		return [{ provider: provider as Provider, subject: account.providerUserId }]
	})

const primaryEmail = (user: ClerkUser) =>
	user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress

const program = Effect.gen(function* () {
	const secretKey = yield* Config.Redacted("CLERK_SECRET_KEY")
	const sql = yield* SqlClient.SqlClient

	const hazelUsers = yield* sql<HazelUser>`
		select id::text as id, "externalId", email, "deletedAt" is not null as deleted, "userType"
		from users`
	const byClerkId = new Map(hazelUsers.map((user) => [user.externalId, user]))
	const activeByEmail = new Map<string, number>()
	for (const user of hazelUsers) {
		if (user.deleted || user.userType !== "user") continue
		const email = user.email.toLowerCase()
		activeByEmail.set(email, (activeByEmail.get(email) ?? 0) + 1)
	}

	const clerkUsers = yield* listClerkUsers(Redacted.value(secretKey))
	yield* Effect.log(`Clerk users: ${clerkUsers.length}. Hazel users: ${hazelUsers.length}.`)

	const report = {
		linked: [] as Array<Entry>,
		emailOnly: [] as Array<Entry>,
		emailShared: [] as Array<Entry>,
		conflicts: [] as Array<Entry>,
		missingInHazel: [] as Array<Entry>,
		missingInClerk: [] as Array<Entry>,
	}
	let identitiesLinked = 0
	let identitiesAlreadyLinked = 0

	for (const clerkUser of clerkUsers) {
		const email = primaryEmail(clerkUser)
		const hazel = byClerkId.get(clerkUser.id)
		if (hazel === undefined) {
			report.missingInHazel.push({ clerkUserId: clerkUser.id, ...(email ? { email } : {}) })
			continue
		}
		if (hazel.deleted || hazel.userType !== "user") continue
		const entry: Entry = { hazelUserId: hazel.id, clerkUserId: clerkUser.id, email: hazel.email }

		const accounts = providerAccounts(clerkUser)
		if (accounts.length === 0) {
			const shared = (activeByEmail.get(hazel.email.toLowerCase()) ?? 0) > 1
			;(shared ? report.emailShared : report.emailOnly).push(entry)
			continue
		}

		report.linked.push({ ...entry, detail: accounts.map((account) => account.provider).join("+") })
		if (!apply) continue
		for (const account of accounts) {
			const result = yield* linkIdentity({ ...account, userId: hazel.id })
			if (result._tag === "Linked") identitiesLinked++
			else if (result._tag === "AlreadyLinked") identitiesAlreadyLinked++
			else
				report.conflicts.push({
					...entry,
					detail: `${account.provider} account already belongs to Hazel user ${result.ownerId}`,
				})
		}
	}

	const clerkIds = new Set(clerkUsers.map((user) => user.id))
	for (const user of hazelUsers) {
		if (user.deleted || user.userType !== "user" || clerkIds.has(user.externalId)) continue
		// Users created by Hazel sign-in itself are not in Clerk by design.
		if (user.externalId.startsWith("hazel:")) continue
		report.missingInClerk.push({ hazelUserId: user.id, email: user.email, detail: user.externalId })
	}

	mkdirSync("./exports", { recursive: true })
	writeFileSync(REPORT_PATH, JSON.stringify(report, null, "\t"))

	yield* Effect.log(apply ? "Applied." : "Dry run: nothing written. Re-run with --apply to link.")
	yield* Effect.log(`  linked (GitHub/Google):  ${report.linked.length}`)
	yield* Effect.log(`  email only:              ${report.emailOnly.length}`)
	yield* Effect.log(`  email shared (manual):   ${report.emailShared.length}`)
	yield* Effect.log(`  missing in Hazel:        ${report.missingInHazel.length}`)
	yield* Effect.log(`  missing in Clerk:        ${report.missingInClerk.length}`)
	if (apply) {
		yield* Effect.log(`  identities linked now:   ${identitiesLinked}`)
		yield* Effect.log(`  already linked:          ${identitiesAlreadyLinked}`)
		yield* Effect.log(`  conflicts (manual):      ${report.conflicts.length}`)
	}
	yield* Effect.log(`Report: ${REPORT_PATH}`)
})

const SqlLive = PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })

Effect.runPromise(program.pipe(Effect.provide(SqlLive), Effect.provide(CryptoLive))).catch((error) => {
	console.error(error)
	process.exit(1)
})
