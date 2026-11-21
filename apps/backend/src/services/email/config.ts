/**
 * Where support mailboxes receive and send (`docs/customers/email.md`): a mailbox `abc` receives at
 * `abc@<INBOUND_EMAIL_DOMAIN>` (Email Routing → the api Worker) and replies from
 * `abc@<SUPPORT_EMAIL_DOMAIN>` (onboarded to Cloudflare Email Sending, like invitations).
 */
import { Config } from "effect"
import { INVITE_EMAIL_DOMAIN } from "../invite-mailer"

export const DEFAULT_INBOUND_EMAIL_DOMAIN = "inbound.hazel.sh"

export const EmailDomainsConfig = Config.all({
	inbound: Config.String("INBOUND_EMAIL_DOMAIN").pipe(Config.withDefault(DEFAULT_INBOUND_EMAIL_DOMAIN)),
	sending: Config.String("SUPPORT_EMAIL_DOMAIN").pipe(Config.withDefault(INVITE_EMAIL_DOMAIN)),
})
export type EmailDomains = typeof EmailDomainsConfig extends Config.Config<infer A> ? A : never

export const inboundAddressOf = (domains: EmailDomains, mailboxId: string) =>
	`${mailboxId}@${domains.inbound.toLowerCase()}`

export const sendingAddressOf = (domains: EmailDomains, mailboxId: string) =>
	`${mailboxId}@${domains.sending.toLowerCase()}`
