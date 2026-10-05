import { verifyToken } from "@clerk/backend"
import { CurrentUser, InvalidBearerTokenError, InvalidJwtPayloadError, SessionLoadError } from "@hazel/domain"
import { User } from "@hazel/domain/models"
import { ClerkJwtClaims, type ClerkUserId, type UserId } from "@hazel/schema"
import { Context, Config, Effect, Layer, Option, Redacted, Schema } from "effect"
import { ClerkClient } from "../session/clerk-client.ts"

type UserRow = {
	id: UserId
	email: string
	firstName: string
	lastName: string
	avatarUrl: string | null
	isOnboarded: boolean
	timezone: string | null
	settings: User.UserSettings | null
}

/**
 * Interface for the user repository methods needed by backend auth.
 * Avoids circular dependencies by not depending on the full UserRepo.
 */
export interface UserRepoLike {
	findByExternalId: (
		externalId: string,
	) => Effect.Effect<Option.Option<UserRow>, { _tag: "DatabaseError" }, any>
	upsertClerkUser: (user: {
		externalId: ClerkUserId
		email: string
		firstName: string
		lastName: string
		avatarUrl: string | null
		userType: "user" | "machine"
		settings: null
		isOnboarded: boolean
		timezone: string | null
		deletedAt: null
	}) => Effect.Effect<UserRow, { _tag: "DatabaseError" }, any>
	update: (data: {
		id: UserId
		firstName?: string
		lastName?: string
		avatarUrl?: string | null
	}) => Effect.Effect<UserRow, { _tag: "DatabaseError" } | { _tag: "SchemaError" }, any>
}

export const decodeClerkJwtClaims = Schema.decodeUnknownEffect(ClerkJwtClaims)

/**
 * Backend authentication service. Verifies Clerk bearer JWTs and syncs the
 * user into the DB if it's their first request.
 */
export class BackendAuth extends Context.Service<BackendAuth>()("@hazel/auth/BackendAuth", {
	make: Effect.gen(function* () {
		const clerk = yield* ClerkClient
		const clerkSecretKey = yield* Config.Redacted("CLERK_SECRET_KEY")

		const normalizeAvatarUrl = (avatarUrl: string | null | undefined): string | null =>
			avatarUrl?.trim() ? avatarUrl : null

		const syncUserFromClerk = (
			userRepo: UserRepoLike,
			clerkUserId: ClerkUserId,
			email: string,
			firstName: string | null,
			lastName: string | null,
			avatarUrl: string | null,
		) =>
			Effect.gen(function* () {
				const userOption = yield* userRepo.findByExternalId(clerkUserId).pipe(
					Effect.catchTags({
						DatabaseError: (err) =>
							Effect.fail(
								new SessionLoadError({
									message: "Failed to query user by external ID",
									detail: String(err),
								}),
							),
					}),
				)

				return yield* Option.match(userOption, {
					onNone: () =>
						userRepo
							.upsertClerkUser({
								externalId: clerkUserId,
								email,
								firstName: firstName || "",
								lastName: lastName || "",
								avatarUrl: normalizeAvatarUrl(avatarUrl),
								userType: "user",
								settings: null,
								isOnboarded: false,
								timezone: null,
								deletedAt: null,
							})
							.pipe(
								Effect.catchTags({
									DatabaseError: (err) =>
										Effect.fail(
											new SessionLoadError({
												message: "Failed to create user",
												detail: String(err),
											}),
										),
								}),
							),
					onSome: (existing) => Effect.succeed(existing),
				})
			})

		const authenticate = (bearerToken: string, userRepo: UserRepoLike) =>
			Effect.gen(function* () {
				const payload = yield* Effect.tryPromise({
					try: () => verifyToken(bearerToken, { secretKey: Redacted.value(clerkSecretKey) }),
					catch: (error) =>
						new InvalidBearerTokenError({
							message: `Clerk JWT verification failed: ${error}`,
							detail: String(error),
						}),
				})

				const claims = yield* decodeClerkJwtClaims(payload).pipe(
					Effect.mapError(
						(error) =>
							new InvalidJwtPayloadError({
								message: "Invalid Clerk JWT claims",
								detail: String(error),
							}),
					),
				)

				const userOption = yield* userRepo.findByExternalId(claims.sub).pipe(
					Effect.catchTags({
						DatabaseError: (err) =>
							Effect.fail(
								new InvalidBearerTokenError({
									message: "Failed to query user",
									detail: String(err),
								}),
							),
					}),
				)

				const user = yield* Option.match(userOption, {
					onNone: () =>
						Effect.gen(function* () {
							const clerkUser = yield* clerk.getUser(claims.sub)
							const email = claims.email ?? clerkUser.emailAddresses[0]?.emailAddress ?? ""
							return yield* syncUserFromClerk(
								userRepo,
								claims.sub,
								email,
								clerkUser.firstName,
								clerkUser.lastName,
								clerkUser.imageUrl ?? null,
							)
						}),
					onSome: (u) => Effect.succeed(u),
				})

				// Map Clerk org role ("org:admin" / "org:member") to our CurrentUser.role.
				const currentUserRole: "admin" | "member" | "owner" =
					claims.org_role === "org:admin" ? "admin" : "member"

				return new CurrentUser.Schema({
					id: user.id,
					role: currentUserRole,
					organizationId: undefined,
					avatarUrl: user.avatarUrl ?? undefined,
					firstName: user.firstName,
					lastName: user.lastName,
					email: user.email,
					isOnboarded: user.isOnboarded,
					timezone: user.timezone,
					settings: user.settings,
				})
			})

		return {
			authenticate,
			syncUserFromClerk,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(ClerkClient.layer))

	/** Mock user ID - a valid UUID */
	static readonly mockUserId = "00000000-0000-4000-8000-000000000001" as UserId

	static mockUser = () => ({
		id: BackendAuth.mockUserId,
		email: "test@example.com",
		firstName: "Test",
		lastName: "User",
		avatarUrl: null,
		isOnboarded: true,
		timezone: "UTC" as string | null,
		settings: null as User.UserSettings | null,
	})

	static mockCurrentUser = () =>
		new CurrentUser.Schema({
			id: BackendAuth.mockUserId,
			role: "member",
			organizationId: undefined,
			avatarUrl: undefined,
			firstName: "Test",
			lastName: "User",
			email: "test@example.com",
			isOnboarded: true,
			timezone: "UTC",
			settings: null,
		})

	static Test = Layer.mock(this, {
		authenticate: (_bearerToken: string, _userRepo: UserRepoLike) =>
			Effect.succeed(BackendAuth.mockCurrentUser()),
		syncUserFromClerk: (
			_userRepo: UserRepoLike,
			_clerkUserId: string,
			_email: string,
			_firstName: string | null,
			_lastName: string | null,
			_avatarUrl: string | null,
		) => Effect.succeed(BackendAuth.mockUser()),
	})

	static TestWith = (options: {
		currentUser?: CurrentUser.Schema
		shouldFail?: { authenticate?: Effect.Effect<never, any> }
	}) =>
		Layer.mock(BackendAuth, {
			authenticate: (_bearerToken: string, _userRepo: UserRepoLike) =>
				options.shouldFail?.authenticate ??
				Effect.succeed(options.currentUser ?? BackendAuth.mockCurrentUser()),
			syncUserFromClerk: (
				_userRepo: UserRepoLike,
				_clerkUserId: string,
				_email: string,
				_firstName: string | null,
				_lastName: string | null,
				_avatarUrl: string | null,
			) => Effect.succeed(BackendAuth.mockUser()),
		})
}

export const BackendAuthLive = BackendAuth.layer
