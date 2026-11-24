import { Config } from "effect"

/**
 * Who may use a Hazel install, from three plain env values (`apps/backend/src/worker/env.ts`):
 *
 * - `ALLOWED_EMAIL_DOMAINS`: comma-separated email domains. When any is listed, a person signs in
 *   (or signs up) only with an email at one of them; a subdomain matches only when it is listed
 *   itself. Unset or blank: anyone.
 * - `INSTANCE_ADMIN_EMAILS`: comma-separated emails of the install's admins.
 * - `ORG_CREATION`: `anyone` (the default, also for blank or unknown values) or `admins`.
 *
 * Every comparison is case-insensitive; entries are trimmed and blanks ignored. Pure apart from
 * `InstanceAccessConfig`, which reads the env.
 */

export type OrgCreation = "anyone" | "admins"

export interface InstanceAccess {
	/** Lowercased, without a leading `@`; empty: anyone may sign in. */
	readonly allowedEmailDomains: ReadonlyArray<string>
	/** Lowercased. */
	readonly instanceAdminEmails: ReadonlyArray<string>
	readonly orgCreation: OrgCreation
}

const entries = (raw: string | undefined): ReadonlyArray<string> => [
	...new Set(
		(raw ?? "")
			.split(",")
			.map((entry) => entry.trim().toLowerCase())
			.filter((entry) => entry !== ""),
	),
]

export const parseEmailDomains = (raw: string | undefined): ReadonlyArray<string> =>
	entries(raw).flatMap((domain) => {
		const bare = domain.replace(/^@+/, "")
		return bare === "" ? [] : [bare]
	})

export const parseAdminEmails = (raw: string | undefined): ReadonlyArray<string> => entries(raw)

export const parseOrgCreation = (raw: string | undefined): OrgCreation =>
	raw?.trim().toLowerCase() === "admins" ? "admins" : "anyone"

export const parseInstanceAccess = (env: {
	readonly ALLOWED_EMAIL_DOMAINS?: string | undefined
	readonly INSTANCE_ADMIN_EMAILS?: string | undefined
	readonly ORG_CREATION?: string | undefined
}): InstanceAccess => ({
	allowedEmailDomains: parseEmailDomains(env.ALLOWED_EMAIL_DOMAINS),
	instanceAdminEmails: parseAdminEmails(env.INSTANCE_ADMIN_EMAILS),
	orgCreation: parseOrgCreation(env.ORG_CREATION),
})

const optional = (name: string) => Config.String(name).pipe(Config.withDefault(""))

/** The install's access rules from the env; unset values fall back to "anyone". */
export const InstanceAccessConfig = Config.all({
	ALLOWED_EMAIL_DOMAINS: optional("ALLOWED_EMAIL_DOMAINS"),
	INSTANCE_ADMIN_EMAILS: optional("INSTANCE_ADMIN_EMAILS"),
	ORG_CREATION: optional("ORG_CREATION"),
}).pipe(Config.map(parseInstanceAccess))

/** The domain of an email, lowercased; `undefined` when it has none. */
export const emailDomain = (email: string): string | undefined => {
	const trimmed = email.trim().toLowerCase()
	const at = trimmed.lastIndexOf("@")
	if (at <= 0 || at === trimmed.length - 1) return undefined
	return trimmed.slice(at + 1)
}

/** Whether `email` may sign in: always when no domain is listed, else only at a listed domain. */
export const isEmailDomainAllowed = (allowedDomains: ReadonlyArray<string>, email: string): boolean => {
	if (allowedDomains.length === 0) return true
	const domain = emailDomain(email)
	return domain !== undefined && allowedDomains.includes(domain)
}

export const isInstanceAdmin = (adminEmails: ReadonlyArray<string>, email: string): boolean =>
	adminEmails.includes(email.trim().toLowerCase())

/** What a refused sign-in tells the visitor, e.g. "…only allows sign-in with an @acme.com address". */
export const domainRestrictionMessage = (allowedDomains: ReadonlyArray<string>): string => {
	const listed = allowedDomains.map((domain) => `@${domain}`)
	const choices =
		listed.length <= 1
			? (listed[0] ?? "")
			: `${listed.slice(0, -1).join(", ")} or ${listed[listed.length - 1]}`
	return `This Hazel instance only allows sign-in with an ${choices} address`
}

export const ORG_CREATION_REFUSED_MESSAGE =
	"Only instance admins can create organizations on this Hazel instance"
