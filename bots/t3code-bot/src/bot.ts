/**
 * The T3 Code bot; hosted by `./worker.ts`. `/t3` starts a T3 Code thread on the caller's linked
 * environment (or a teammate's who shares theirs) and opens a Hazel thread that follows it
 * (`./runner.ts`); a reply in that thread is a follow-up, or the answer to the agent's question.
 * Every call to an environment first asks Hazel for the owner's credential for the acting member
 * (`getT3CodeAccess`), which applies the owner's sharing; the bot keeps no credentials.
 */
import { defineBot, type MessageType, type TypedCommandContext } from "@hazel-chat/bot-sdk"
import { HazelApi } from "@hazel/domain/http"
import { makeT3CodeMcpSession, type T3Project } from "@hazel/integrations/t3code"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Config, Effect, FiberMap, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { commands, T3Command, T3ProjectCommand, T3StopCommand } from "./commands.ts"
import {
	answersFrom,
	type ChatPort,
	followThread,
	type LiveMessage,
	orgOf,
	ownerOf,
	T3Run,
	threadOf,
} from "./runner.ts"

const runKey = (threadChannelId: string) => `t3code:run:${threadChannelId}`
const FOLLOWING_KEY = "t3code:following"
const projectKey = (channelId: string) => `t3code:project:${channelId}`
const Following = Schema.Array(Schema.String)

const SETTINGS_HINT = "Settings → Integrations → T3 Code"

const mention = (userId: string) => `@[userId:${userId}]`

const firstError = (cause: Cause.Cause<unknown>) => Option.getOrNull(Cause.findErrorOption(cause))

/** `@[userId:…]` or a bare user id; anything else is not a member. */
export const parseOwner = (raw: string | undefined): UserId | null => {
	const value = raw?.trim() ?? ""
	if (value === "") return null
	const match = /^@\[userId:([^\]]+)\]$/.exec(value) ?? /^([0-9a-f-]{36})$/i.exec(value)
	return match ? (match[1] as UserId) : null
}

/** A project by id, or by title (exact, then prefix), case-insensitive. */
export const findProject = (projects: ReadonlyArray<T3Project>, query: string) => {
	const q = query.trim().toLowerCase()
	return (
		projects.find((project) => project.id === query.trim()) ??
		projects.find((project) => project.title.toLowerCase() === q) ??
		projects.find((project) => project.title.toLowerCase().startsWith(q))
	)
}

const projectList = (projects: ReadonlyArray<T3Project>) =>
	projects.map((project) => `- \`${project.title}\``).join("\n")

const tagOf = (error: unknown) =>
	typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""

/** Why a call to an owner's environment could not happen, as a chat message. */
export const explain = (
	error: unknown,
	ctx: { readonly ownerId: UserId; readonly actorId: UserId },
): string => {
	const tag = tagOf(error)
	const own = ctx.ownerId === ctx.actorId
	switch (tag) {
		case "T3CodeNotConnectedError":
			return own
				? `Link your T3 Code environment first: ${SETTINGS_HINT}.`
				: `${mention(ctx.ownerId)} has not linked T3 Code.`
		case "T3CodeAccessDeniedError":
			return `${mention(ctx.ownerId)} does not share their T3 Code with you.`
		case "T3CodeExpiredError":
		case "T3CodeUnauthorizedError":
			return `${own ? "Your" : `${mention(ctx.ownerId)}'s`} T3 Code sign-in has expired or was revoked. Reconnect in ${SETTINGS_HINT}.`
		case "T3CodeUnreachableError":
			return "T3 Code is not answering. Is the machine awake and T3 Code running?"
		case "T3CodeToolError":
			return `T3 Code refused: ${(error as { message: string }).message}`
		default:
			return "Something went wrong talking to T3 Code."
	}
}

/** Hazel's T3 Code endpoints, as this bot. */
const makeHazel = Effect.gen(function* () {
	const backendUrl = yield* Config.String("BACKEND_URL").pipe(Config.withDefault("https://api.hazel.sh"))
	const token = yield* Config.Redacted("BOT_TOKEN")
	return yield* HttpApiClient.make(HazelApi, { baseUrl: backendUrl }).pipe(
		Effect.provide(
			FetchHttpClient.layer.pipe(
				Layer.provide(
					Layer.succeed(FetchHttpClient.RequestInit, {
						headers: { Authorization: `Bearer ${Redacted.value(token)}` },
					}),
				),
			),
		),
	)
})

export const bot = defineBot({
	serviceName: "t3code-bot",
	commands,
	layers: [FetchHttpClient.layer],
	setup: (bot) =>
		Effect.gen(function* () {
			// The SDK's setup handle is untyped over commands (as in the other first-party bots).
			const sdk = bot as any
			const hazel = yield* makeHazel
			const followers = yield* FiberMap.make<string>()
			const self = (yield* sdk.getAuthContext) as { readonly userId: UserId }

			/** A session with the owner's environment, for the acting member. */
			const environmentFor = (organizationId: OrganizationId, ownerId: UserId, actorId: UserId) =>
				Effect.gen(function* () {
					const access = yield* hazel.t3code.getT3CodeAccess({
						payload: { organizationId, ownerId, actorId },
					})
					const mcp = yield* makeT3CodeMcpSession({
						mcpUrl: access.mcpUrl,
						accessToken: access.accessToken,
					})
					return { access, mcp }
				})

			const loadRun = (threadChannelId: string) =>
				sdk.state.getJson(runKey(threadChannelId), T3Run) as Effect.Effect<T3Run | null, unknown>
			const saveRun = (run: T3Run) =>
				sdk.state.setJson(runKey(run.threadChannelId), T3Run, run) as Effect.Effect<void, unknown>
			const updateFollowing = (f: (ids: ReadonlyArray<string>) => ReadonlyArray<string>) =>
				Effect.gen(function* () {
					const ids = ((yield* sdk.state.getJson(FOLLOWING_KEY, Following)) ??
						[]) as ReadonlyArray<string>
					yield* sdk.state.setJson(FOLLOWING_KEY, Following, f(ids))
				})

			/** Merge `patch` over the stored run: a follower and a reply each own their fields. */
			const updateRun = (threadChannelId: string, patch: Partial<T3Run>) =>
				Effect.gen(function* () {
					const stored = yield* loadRun(threadChannelId)
					if (stored !== null) yield* saveRun({ ...stored, ...patch })
				})

			const post = (channelId: ChannelId, content: string) =>
				Effect.asVoid(sdk.message.send(channelId, content)) as Effect.Effect<void, unknown>
			const chatFor = (threadChannelId: string): ChatPort => ({
				post,
				live: (channelId) => sdk.stream.create(channelId) as Effect.Effect<LiveMessage, unknown>,
				updateRun: (patch) => updateRun(threadChannelId, patch),
			})
			const chat = { post }

			const refused = new Set<string>()

			/** Threads that got a follow-up while their follower ran: it keeps going. */
			const pokes = new Set<string>()

			/**
			 * A handler failed: log it, tell the channel why in words, and when T3 refused the
			 * owner's credential, have Hazel mark the link expired so their settings say so.
			 */
			const failed =
				(
					label: string,
					channelId: ChannelId,
					who: {
						readonly organizationId: OrganizationId
						readonly ownerId: UserId
						readonly actorId: UserId
					},
				) =>
				(cause: Cause.Cause<unknown>) => {
					const error = firstError(cause)
					// Say "not shared with you" once per member and thread: never loop with a bot.
					const refusal = `${channelId}:${who.actorId}`
					const quiet = tagOf(error) === "T3CodeAccessDeniedError" && refused.has(refusal)
					if (tagOf(error) === "T3CodeAccessDeniedError") refused.add(refusal)
					return Effect.logWarning(`${label} failed`, { cause }).pipe(
						Effect.andThen(
							tagOf(error) === "T3CodeUnauthorizedError"
								? hazel.t3code.reportT3CodeExpired({
										payload: { organizationId: who.organizationId, ownerId: who.ownerId },
									})
								: Effect.void,
						),
						Effect.andThen(quiet ? Effect.void : chat.post(channelId, explain(error, who))),
						Effect.ignore,
					)
				}

			const whoOf = (run: T3Run, actorId: UserId) => ({
				organizationId: orgOf(run),
				ownerId: ownerOf(run),
				actorId,
			})

			/**
			 * Follow a Hazel thread's T3 thread until it idles; one follower per thread. A follower
			 * already running is poked instead, so it does not stop before the new run.
			 */
			const follow = (run: T3Run) => {
				const id = run.threadChannelId
				pokes.add(id)
				return FiberMap.run(
					followers,
					id,
					Effect.gen(function* () {
						yield* updateFollowing((ids) => [...new Set([...ids, id])])
						// The owner's own access: a run they allowed keeps reporting to its thread.
						const { mcp } = yield* environmentFor(orgOf(run), ownerOf(run), ownerOf(run))
						pokes.delete(id)
						const takePoke = Effect.sync(() => pokes.delete(id))
						for (;;) {
							const latest = (yield* loadRun(id)) ?? run
							yield* followThread({ mcp, chat: chatFor(id), run: latest, takePoke })
							// Poked after its last check: follow again rather than drop the follow-up.
							if (!pokes.delete(id)) break
						}
					}).pipe(
						Effect.catchCause(
							failed("T3 Code follower", threadOf(run), whoOf(run, ownerOf(run))),
						),
						Effect.ensuring(
							updateFollowing((ids) => ids.filter((other) => other !== id)).pipe(Effect.ignore),
						),
						Effect.withSpan("t3code.follow", { attributes: { "hazel.thread_channel_id": id } }),
					),
					{ onlyIfMissing: true },
				)
			}

			// Pick up the threads that were being followed when the bot last stopped.
			const following = ((yield* sdk.state
				.getJson(FOLLOWING_KEY, Following)
				.pipe(Effect.orElseSucceed(() => null))) ?? []) as ReadonlyArray<string>
			for (const threadChannelId of following) {
				const run = yield* loadRun(threadChannelId).pipe(Effect.orElseSucceed(() => null))
				if (run !== null) yield* follow(run)
			}

			yield* sdk.onCommand(T3Command, (ctx: TypedCommandContext<typeof T3Command.argsSchema.Type>) => {
				const actorId = ctx.userId
				const ownerArg = ctx.args.owner?.trim() ?? ""
				const ownerId = parseOwner(ownerArg) ?? actorId
				const who = { organizationId: ctx.orgId, ownerId, actorId }
				return Effect.gen(function* () {
					if (ownerArg !== "" && parseOwner(ownerArg) === null) {
						return yield* chat.post(ctx.channelId, "Name the owner with an @mention.")
					}
					const { access, mcp } = yield* environmentFor(ctx.orgId, ownerId, actorId)
					const projects = yield* mcp.listProjects()
					const wanted =
						ctx.args.project ??
						((yield* sdk.state.get(projectKey(ctx.channelId))) as string | null) ??
						undefined
					const project =
						wanted !== undefined
							? findProject(projects, wanted)
							: projects.length === 1
								? projects[0]
								: undefined
					if (project === undefined) {
						return yield* chat.post(
							ctx.channelId,
							projects.length === 0
								? `No projects in T3 Code on ${access.environmentLabel}. Add one in T3 Code first.`
								: `${wanted === undefined ? "Which project?" : `No project matches \`${wanted}\`.`} Pass \`project\`, or set this channel's with \`/t3-project\`:\n${projectList(projects)}`,
						)
					}

					const prompt = ctx.args.prompt.trim()
					const root = yield* sdk.message.send(
						ctx.channelId,
						[
							`**T3 Code** · \`${project.title}\` on ${access.environmentLabel}${ownerId === actorId ? "" : ` (${mention(ownerId)}'s)`}`,
							`${mention(actorId)}: ${prompt}`,
						].join("\n"),
					)
					const thread = yield* sdk.channel.createThread(root.id, ctx.channelId)
					const launched = yield* mcp.launchThread({
						projectId: project.id,
						title: prompt.length > 80 ? `${prompt.slice(0, 79)}…` : prompt,
						message: prompt,
					})
					const run: T3Run = {
						organizationId: ctx.orgId,
						ownerId,
						threadChannelId: thread.id,
						t3ThreadId: launched.threadId,
						link: launched.link ?? null,
						projectTitle: project.title,
						environmentLabel: access.environmentLabel,
						cursor: null,
						pendingQuestion: null,
						notifiedApprovals: [],
					}
					yield* saveRun(run)
					yield* chat.post(
						thread.id,
						`${run.link === null ? "Following the T3 Code thread." : `Following [the T3 Code thread](${run.link}).`} Reply here to send follow-ups; \`/t3-stop\` stops the run.`,
					)
					yield* follow(run)
				}).pipe(
					Effect.catchCause(failed("/t3", ctx.channelId, who)),
					Effect.withSpan("t3code.command.t3", {
						attributes: { "t3code.shared": ownerId !== actorId },
					}),
				)
			})

			yield* sdk.onCommand(
				T3ProjectCommand,
				(ctx: TypedCommandContext<typeof T3ProjectCommand.argsSchema.Type>) =>
					Effect.gen(function* () {
						const { access, mcp } = yield* environmentFor(ctx.orgId, ctx.userId, ctx.userId)
						const projects = yield* mcp.listProjects()
						const wanted = ctx.args.project?.trim() ?? ""
						if (wanted === "") {
							return yield* chat.post(
								ctx.channelId,
								`Projects in T3 Code on ${access.environmentLabel}:\n${projectList(projects)}`,
							)
						}
						const project = findProject(projects, wanted)
						if (project === undefined) {
							return yield* chat.post(
								ctx.channelId,
								`No project matches \`${wanted}\`:\n${projectList(projects)}`,
							)
						}
						yield* sdk.state.set(projectKey(ctx.channelId), project.title)
						yield* chat.post(
							ctx.channelId,
							`\`/t3\` in this channel now uses \`${project.title}\`.`,
						)
					}).pipe(
						Effect.catchCause(
							failed("/t3-project", ctx.channelId, {
								organizationId: ctx.orgId,
								ownerId: ctx.userId,
								actorId: ctx.userId,
							}),
						),
						Effect.withSpan("t3code.command.project"),
					),
			)

			yield* sdk.onCommand(T3StopCommand, (ctx: TypedCommandContext<{}>) =>
				Effect.gen(function* () {
					const run = yield* loadRun(ctx.channelId)
					if (run === null)
						return yield* chat.post(ctx.channelId, "Use `/t3-stop` in a T3 Code thread.")
					yield* Effect.gen(function* () {
						const { mcp } = yield* environmentFor(orgOf(run), ownerOf(run), ctx.userId)
						const stopped = yield* mcp.interrupt(run.t3ThreadId, "Stopped from Hazel")
						yield* chat.post(
							ctx.channelId,
							stopped.status === "no_active_run"
								? "Nothing is running."
								: `${mention(ctx.userId)} stopped the run.`,
						)
					}).pipe(Effect.catchCause(failed("/t3-stop", ctx.channelId, whoOf(run, ctx.userId))))
				}).pipe(Effect.ignore, Effect.withSpan("t3code.command.stop")),
			)

			// A reply in a T3 Code thread: the answer to its question, else a follow-up.
			yield* sdk.onMessage((message: MessageType) =>
				Effect.gen(function* () {
					if (message.authorId === self.userId) return
					const content = message.content.trim()
					if (content === "" || content.startsWith("/")) return
					const run = yield* loadRun(message.channelId)
					if (run === null) return
					yield* Effect.gen(function* () {
						const { mcp } = yield* environmentFor(orgOf(run), ownerOf(run), message.authorId)
						const pending = run.pendingQuestion
						if (pending !== null) {
							yield* updateRun(run.threadChannelId, { pendingQuestion: null })
							const open = yield* mcp.pendingQuestions(run.t3ThreadId)
							if (open.includes(pending.requestId)) {
								yield* mcp.answerQuestion(
									run.t3ThreadId,
									pending.requestId,
									answersFrom(pending.questionIds, content),
								)
								return yield* follow({ ...run, pendingQuestion: null })
							}
						}
						// The message id makes a redelivered event send once.
						yield* mcp.send({
							threadId: run.t3ThreadId,
							message: content,
							clientRequestId: message.id,
						})
						yield* follow({ ...run, pendingQuestion: null })
					}).pipe(
						Effect.catchCause(
							failed("T3 Code follow-up", threadOf(run), whoOf(run, message.authorId)),
						),
					)
				}).pipe(Effect.ignore, Effect.withSpan("t3code.followUp")),
			)
		}),
})
