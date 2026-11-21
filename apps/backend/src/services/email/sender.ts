/**
 * Sends a support mailbox's replies (`docs/customers/email.md`). On the api Worker (and its objects)
 * this is Cloudflare Email Sending through the `EMAIL` binding, which answers the sent message's
 * `Message-ID`; `alchemy dev` writes the message to `.alchemy/local/email` instead.
 */
import { Config, Context, Effect, Layer, Schema } from "effect"

export interface OutboundEmail {
	readonly from: { readonly email: string; readonly name: string }
	readonly to: ReadonlyArray<string>
	readonly replyTo: string
	readonly subject: string
	readonly text: string
	readonly html: string
	/** `In-Reply-To` and `References`. */
	readonly headers: Readonly<Record<string, string>>
}

export class EmailSendError extends Schema.TaggedError<EmailSendError, { readonly brand: unique symbol }>()(
	"EmailSendError",
	{ message: Schema.String },
) {}

/** The part of the Workers `send_email` binding this uses. */
export interface SendEmailBinding {
	readonly send: (message: {
		readonly from: { readonly email: string; readonly name: string }
		readonly to: Array<string>
		readonly replyTo: string
		readonly subject: string
		readonly text: string
		readonly html: string
		readonly headers: Record<string, string>
	}) => Promise<{ readonly messageId?: string } | undefined | void>
}

const isSendEmailBinding = (value: unknown): value is SendEmailBinding =>
	typeof value === "object" && value !== null && "send" in value && typeof value.send === "function"

export class EmailSender extends Context.Service<
	EmailSender,
	{
		/** Answers the sent message's `Message-ID` as the provider reported it (null: it did not). */
		readonly send: (
			email: OutboundEmail,
		) => Effect.Effect<{ readonly messageId: string | null }, EmailSendError>
	}
>()("@hazel/backend/EmailSender") {
	static readonly layerBinding = (binding: SendEmailBinding) =>
		Layer.succeed(EmailSender, {
			send: Effect.fn("EmailSender.send")(function* (email: OutboundEmail) {
				yield* Effect.annotateCurrentSpan({ "email.recipients": email.to.length })
				const result = yield* Effect.tryPromise({
					try: () =>
						binding.send({
							from: email.from,
							to: [...email.to],
							replyTo: email.replyTo,
							subject: email.subject,
							text: email.text,
							html: email.html,
							headers: { ...email.headers },
						}),
					catch: (error) =>
						new EmailSendError({
							message: error instanceof Error ? error.message : String(error),
						}),
				})
				return { messageId: result?.messageId ?? null }
			}),
		})

	/** Without a binding, only explicit development mode pretends to send (and logs it). */
	static readonly layerLog = Layer.effect(
		EmailSender,
		Effect.gen(function* () {
			const isDev = yield* Config.Boolean("IS_DEV").pipe(Config.withDefault(false))
			return {
				send: (email: OutboundEmail) =>
					isDev
						? Effect.as(
								Effect.logInfo("[email] development reply (not sent)", {
									to: email.to,
									subject: email.subject,
								}),
								{ messageId: null },
							)
						: Effect.fail(new EmailSendError({ message: "Email sending is not configured" })),
			}
		}),
	)

	/** The `EMAIL` binding off a Worker env, else `layerLog`. */
	static readonly layerEnv = (env: Record<string, unknown>, bindingName: string) =>
		Layer.suspend(() => {
			const binding = env[bindingName]
			return isSendEmailBinding(binding) ? EmailSender.layerBinding(binding) : EmailSender.layerLog
		})
}
