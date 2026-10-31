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
import { answersFrom, followThread, type LiveMessage, orgOf, ownerOf, T3Run, threadOf } from "./runner.ts"

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

/** Why a call to an owner's environment could not happen, as a chat message. */
const explain = (error: unknown, ctx: { readonly ownerId: UserId; readonly actorId: UserId }): string => {
	const tag = typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""
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

			const chat = {
				post: (channelId: ChannelId, content: string) =>
					Effect.asVoid(sdk.message.send(channelId, content)) as Effect.Effect<void, unknown>,
				live: (channelId: ChannelId) =>
					sdk.stream.create(channelId) as Effect.Effect<LiveMessage, unknown, unknown>,
				saveRun,
			}

			/** Follow a Hazel thread's T3 thread until it idles; one follower per thread. */
			const follow = (run: T3Run) =>
				FiberMap.run(
					followers,
					run.threadChannelId,
					Effect.gen(function* () {
						yield* updateFollowing((ids) => [...new Set([...ids, run.threadChannelId])])
						const { mcp } = yield* environmentFor(orgOf(run), ownerOf(run), ownerOf(run))
						yield* followThread({ mcp, chat, run })
					}).pipe(
						Effect.catchCause((cause) =>
							Effect.logWarning("T3 Code follower stopped", {
								threadChannelId: run.threadChannelId,
								cause,
							}).pipe(
								Effect.andThen(
									chat.post(
										threadOf(run),
										explain(firstError(cause), {
											ownerId: ownerOf(run),
											actorId: ownerOf(run),
										}),
									),
								),
								Effect.ignore,
							),
						),
						Effect.ensuring(
							updateFollowing((ids) => ids.filter((id) => id !== run.threadChannelId)).pipe(
								Effect.ignore,
							),
						),
						Effect.withSpan("t3code.follow", {
							attributes: { "hazel.thread_channel_id": run.threadChannelId },
						}),
					),
					{ onlyIfMissing: true },
				)

			// Pick up the threads that were being followed when the bot last stopped.
			const following = ((yield* sdk.state
				.getJson(FOLLOWING_KEY, Following)
				.pipe(Effect.orElseSucceed(() => null))) ?? []) as ReadonlyArray<string>
			for (const threadChannelId of following) {
				const run = yield* loadRun(threadChannelId).pipe(Effect.orElseSucceed(() => null))
				if (run !== null) yield* follow(run)
			}

			yield* sdk.onCommand(T3Command, (ctx: TypedCommandContext<typeof T3Command.argsSchema.Type>) =>
				Effect.gen(function* () {
					const actorId = ctx.userId
					const ownerArg = ctx.args.owner
					const ownerId = parseOwner(ownerArg) ?? actorId
					if (ownerArg !== undefined && ownerArg.trim() !== "" && parseOwner(ownerArg) === null) {
						return yield* chat.post(ctx.channelId, "Name the owner with an @mention.")
					}
					const environment = yield* environmentFor(ctx.orgId, ownerId, actorId).pipe(Effect.result)
					if (environment._tag === "Failure") {
						return yield* chat.post(
							ctx.channelId,
							explain(environment.failure, { ownerId, actorId }),
						)
					}
					const { access, mcp } = environment.success
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
					if (run.link !== null) {
						yield* chat.post(
							thread.id,
							`Following [the T3 Code thread](${run.link}). Reply here to send follow-ups; \`/t3-stop\` stops the run.`,
						)
					}
					yield* follow(run)
				}).pipe(
					Effect.catchCause((cause) =>
						Effect.logError("/t3 failed", { cause }).pipe(
							Effect.andThen(
								chat.post(
									ctx.channelId,
									explain(firstError(cause), { ownerId: ctx.userId, actorId: ctx.userId }),
								),
							),
							Effect.ignore,
						),
					),
					Effect.withSpan("t3code.command.t3"),
				),
			)

			yield* sdk.onCommand(
				T3ProjectCommand,
				(ctx: TypedCommandContext<typeof T3ProjectCommand.argsSchema.Type>) =>
					Effect.gen(function* () {
						const environment = yield* environmentFor(ctx.orgId, ctx.userId, ctx.userId).pipe(
							Effect.result,
						)
						if (environment._tag === "Failure") {
							return yield* chat.post(
								ctx.channelId,
								explain(environment.failure, { ownerId: ctx.userId, actorId: ctx.userId }),
							)
						}
						const projects = yield* environment.success.mcp.listProjects()
						const wanted = ctx.args.project
						if (wanted === undefined || wanted.trim() === "") {
							return yield* chat.post(
								ctx.channelId,
								`Projects in T3 Code on ${environment.success.access.environmentLabel}:\n${projectList(projects)}`,
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
						Effect.catchCause((cause) =>
							Effect.logError("/t3-project failed", { cause }).pipe(
								Effect.andThen(
									chat.post(ctx.channelId, "Something went wrong talking to T3 Code."),
								),
								Effect.ignore,
							),
						),
					),
			)

			yield* sdk.onCommand(T3StopCommand, (ctx: TypedCommandContext<{}>) =>
				Effect.gen(function* () {
					const run = yield* loadRun(ctx.channelId)
					if (run === null)
						return yield* chat.post(ctx.channelId, "Use `/t3-stop` in a T3 Code thread.")
					const environment = yield* environmentFor(orgOf(run), ownerOf(run), ctx.userId).pipe(
						Effect.result,
					)
					if (environment._tag === "Failure") {
						return yield* chat.post(
							ctx.channelId,
							explain(environment.failure, { ownerId: ownerOf(run), actorId: ctx.userId }),
						)
					}
					const stopped = yield* environment.success.mcp.interrupt(
						run.t3ThreadId,
						"Stopped from Hazel",
					)
					yield* chat.post(
						ctx.channelId,
						stopped.status === "no_active_run"
							? "Nothing is running."
							: `${mention(ctx.userId)} stopped the run.`,
					)
				}).pipe(
					Effect.catchCause((cause) =>
						Effect.logError("/t3-stop failed", { cause }).pipe(
							Effect.andThen(chat.post(ctx.channelId, "Could not stop the run.")),
							Effect.ignore,
						),
					),
				),
			)

			// A reply in a T3 Code thread: the answer to its question, else a follow-up.
			yield* sdk.onMessage((message: MessageType) =>
				Effect.gen(function* () {
					if (message.authorId === self.userId) return
					const content = message.content.trim()
					if (content === "" || content.startsWith("/")) return
					const run = yield* loadRun(message.channelId)
					if (run === null) return
					const actorId = message.authorId
					const environment = yield* environmentFor(orgOf(run), ownerOf(run), actorId).pipe(
						Effect.result,
					)
					if (environment._tag === "Failure") {
						return yield* chat.post(
							threadOf(run),
							explain(environment.failure, { ownerId: ownerOf(run), actorId }),
						)
					}
					const { mcp } = environment.success
					if (run.pendingQuestion !== null) {
						const pending = run.pendingQuestion
						const open = yield* mcp.pendingQuestions(run.t3ThreadId)
						yield* saveRun({ ...run, pendingQuestion: null })
						if (open.includes(pending.requestId)) {
							yield* mcp.answerQuestion(
								run.t3ThreadId,
								pending.requestId,
								answersFrom(pending.questionIds, content),
							)
							return yield* follow({ ...run, pendingQuestion: null })
						}
					}
					yield* mcp.send({
						threadId: run.t3ThreadId,
						message: content,
						clientRequestId: message.id,
					})
					yield* follow({ ...run, pendingQuestion: null })
				}).pipe(
					Effect.catchCause((cause) =>
						Effect.logError("T3 Code follow-up failed", { cause }).pipe(
							Effect.andThen(
								chat.post(message.channelId as ChannelId, "Could not send that to T3 Code."),
							),
							Effect.ignore,
						),
					),
					Effect.withSpan("t3code.followUp"),
				),
			)
		}),
})
