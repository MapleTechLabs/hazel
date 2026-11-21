/**
 * Presence, simulated end to end (`./presence-sim.ts`): fake devices against the real objects, and
 * what a teammate's org shows over time. Each test is one of Discord's rules.
 */
import { ChannelId, type UserId } from "@hazel/schema"
import { makeFakeSocket } from "@hazel/sync-do/testing"
import { Effect, Schema, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { hours, makePresenceSim, minutes, seconds } from "./presence-sim"
import { PRESENCE_LEASE_MS, SESSION_TIMEOUT_MS } from "./presence-timing"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const general = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000a1")
const design = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000a2")

// Hours of simulated pings are thousands of steps: slower than the default 5 s on a CI runner.
describe("presence simulation", { timeout: 60_000 }, () => {
	it("opening the app shows online in every org; quitting shows offline at once", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const desktop = ada.device("desktop")
				yield* desktop.open()
				expect((yield* ada.seen(0)).status).toBe("online")
				expect((yield* ada.seen(1)).status).toBe("online")
				expect(yield* ada.seen()).toMatchObject({ desktopStatus: "online", webStatus: null })

				yield* sim.advance(minutes(3))
				yield* desktop.close
				expect((yield* ada.seen(0)).status).toBe("offline")
				expect((yield* ada.seen(1)).status).toBe("offline")
				expect(ada.timeline).toEqual([
					{ at: 0, status: "offline" },
					{ at: 0, status: "online" },
					{ at: 180, status: "offline" },
				])
			}),
		))

	it("pings keep a session alive for hours, with no other traffic", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.device("web").open()
				yield* sim.advance(hours(2))
				expect(ada.timeline.map(({ status }) => status)).toEqual(["offline", "online"])
			}),
		))

	it("a hidden tab pinging once a minute stays online", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const web = ada.device("web")
				yield* web.open()
				yield* web.report({ hidden: true })
				yield* sim.advance(hours(1))
				expect((yield* ada.seen()).status).toBe("online")
			}),
		))

	it("idle on one device but active on another stays online", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const laptop = ada.device("desktop")
				const browser = ada.device("web")
				yield* laptop.open()
				yield* browser.open()
				yield* laptop.report({ idle: true })
				expect(yield* ada.seen()).toMatchObject({
					status: "online",
					desktopStatus: "away",
					webStatus: "online",
				})
			}),
		))

	it("every device idle shows idle; input anywhere brings back online", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const laptop = ada.device("desktop")
				const browser = ada.device("web")
				yield* laptop.open()
				yield* browser.open()
				yield* sim.advance(minutes(10))
				yield* laptop.report({ idle: true })
				yield* browser.report({ idle: true })
				expect((yield* ada.seen()).status).toBe("away")
				yield* sim.advance(minutes(20))
				yield* browser.report({ idle: false })
				expect((yield* ada.seen()).status).toBe("online")
				expect(ada.timeline).toEqual([
					{ at: 0, status: "offline" },
					{ at: 0, status: "online" },
					{ at: 600, status: "away" },
					{ at: 1800, status: "online" },
				])
			}),
		))

	it("a dropped connection goes offline after the session timeout", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* sim.advance(seconds(10))
				yield* laptop.vanish
				yield* sim.advance(minutes(5))
				// The last ping was at 0s (the open); the session ends at its timeout.
				expect(ada.timeline.at(-1)).toEqual({ at: SESSION_TIMEOUT_MS / 1_000, status: "offline" })
			}),
		))

	it("a socket lost without a close event ends with the next alarm", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const laptop = ada.device("desktop")
				const phone = ada.device("mobile")
				yield* laptop.open()
				yield* phone.open()
				yield* laptop.crash
				yield* sim.advance(minutes(2))
				// The phone keeps pinging; the lost laptop session ended on the first alarm.
				expect(yield* ada.seen()).toMatchObject({
					status: "online",
					desktopStatus: null,
					mobileStatus: "online",
				})
			}),
		))

	it("a laptop that sleeps and wakes comes back online", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* laptop.vanish
				yield* sim.advance(minutes(30))
				expect((yield* ada.seen()).status).toBe("offline")
				yield* laptop.wake
				expect((yield* ada.seen()).status).toBe("online")
				// Its next frame says what it is again.
				yield* laptop.report({ idle: false })
				expect((yield* ada.seen()).desktopStatus).toBe("online")
			}),
		))

	it("invisible looks exactly like offline to everyone, and the pick is kept", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* laptop.report({ focus: general })
				yield* ada.pick("invisible")
				for (const index of [0, 1]) {
					expect(yield* ada.seen(index)).toMatchObject({
						status: "offline",
						desktopStatus: null,
						webStatus: null,
						mobileStatus: null,
						afk: true,
						activeChannelId: null,
					})
				}
				expect((yield* ada.picked)?.status).toBe("invisible")
				// Still invisible after hours of pings and a new device.
				yield* sim.advance(hours(3))
				yield* ada.device("mobile").open()
				expect((yield* ada.seen()).status).toBe("offline")
				yield* ada.pick("online")
				expect((yield* ada.seen()).status).toBe("online")
			}),
		))

	it("dnd for an hour goes back to online at exactly one hour", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.device("desktop").open()
				yield* sim.advance(minutes(5))
				yield* ada.pick("dnd", hours(1))
				expect(yield* ada.seen()).toMatchObject({ status: "dnd", desktopStatus: "dnd" })
				yield* sim.advance(hours(2))
				expect(ada.timeline).toEqual([
					{ at: 0, status: "offline" },
					{ at: 0, status: "online" },
					{ at: 300, status: "dnd" },
					{ at: 3900, status: "online" },
				])
				expect((yield* ada.picked)?.status).toBe("online")
			}),
		))

	it("a pick made while offline applies on the next connection", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.pick("dnd")
				expect((yield* ada.seen()).status).toBe("offline")
				yield* ada.device("mobile").open()
				expect(yield* ada.seen()).toMatchObject({ status: "dnd", mobileStatus: "dnd" })
			}),
		))

	it("chosen idle shows idle while in use", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.device("web").open()
				yield* ada.pick("idle")
				expect((yield* ada.seen()).status).toBe("away")
			}),
		))

	it("only on a phone shows the phone; opening the laptop switches back", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.device("mobile").open()
				expect(yield* ada.seen()).toMatchObject({
					status: "online",
					desktopStatus: null,
					webStatus: null,
					mobileStatus: "online",
					afk: true,
				})
				const laptop = ada.device("desktop")
				yield* laptop.open()
				expect(yield* ada.seen()).toMatchObject({ desktopStatus: "online", afk: false })
				yield* laptop.close
				expect(yield* ada.seen()).toMatchObject({ desktopStatus: null, mobileStatus: "online" })
			}),
		))

	it("afk follows the computers, not the phone", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* ada.device("mobile").open()
				expect((yield* ada.seen()).afk).toBe(false)
				yield* laptop.report({ idle: true, afk: true })
				expect((yield* ada.seen()).afk).toBe(true)
			}),
		))

	it("the channel being read follows the focused window", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* laptop.report({ focus: general })
				expect((yield* ada.seen()).activeChannelId).toBe(general)
				yield* laptop.report({ focus: design })
				expect((yield* ada.seen()).activeChannelId).toBe(design)
				yield* laptop.report({ focus: null })
				expect((yield* ada.seen()).activeChannelId).toBeNull()
			}),
		))

	it("a custom status clears itself in every org when it expires", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.device("web").open()
				yield* ada.customStatus("🍕", "lunch", minutes(30))
				expect(yield* ada.seen(1)).toMatchObject({ statusEmoji: "🍕", customMessage: "lunch" })
				yield* sim.advance(minutes(31))
				expect(yield* ada.seen(1)).toMatchObject({ statusEmoji: null, customMessage: null })
				expect((yield* ada.seen(1)).status).toBe("online")
			}),
		))

	it("a custom status set while offline is seen, and stays offline", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.customStatus("🏖️", "on holiday")
				expect(yield* ada.seen()).toMatchObject({ status: "offline", statusEmoji: "🏖️" })
			}),
		))

	it("an evicted object keeps its sessions", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.device("desktop").open()
				yield* sim.advance(minutes(1))
				yield* sim.evict(ada)
				yield* sim.advance(minutes(10))
				expect(ada.timeline.map(({ status }) => status)).toEqual(["offline", "online"])
			}),
		))

	it("an org whose copy is never renewed marks it offline on its own", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.device("desktop").open()
				// The user's object stops reaching org 1 (and its alarm can't fix that).
				const unreachable = sim.orgIds[1]!
				sim.objects.setUnreachable({ kind: "org", id: unreachable }, true)
				yield* sim.advance(PRESENCE_LEASE_MS + minutes(1))
				expect((yield* ada.seen(0)).status).toBe("online")
				expect((yield* ada.seen(1)).status).toBe("offline")
				sim.objects.setUnreachable({ kind: "org", id: unreachable }, false)
				yield* sim.advance(minutes(3))
				expect((yield* ada.seen(1)).status).toBe("online")
			}),
		))

	it("a pick that has already expired saves, and answers, online", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				yield* ada.device("web").open()
				const saved = yield* ada.pick("dnd", -seconds(1))
				expect(saved).toMatchObject({ status: "online", statusExpiresAt: null })
				expect((yield* ada.seen()).status).toBe("online")
			}),
		))

	it("binary ping frames keep a session alive too", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const user = yield* ada.object
				const socket = makeFakeSocket()
				expect(yield* user.adopt(socket, { userId: ada.id, expiresAt: null })).toBe("accepted")
				const ping = new TextEncoder().encode(JSON.stringify({ _tag: "Ping" }))
				for (let minute = 1; minute <= 10; minute++) {
					yield* sim.advance(seconds(25))
					yield* user.onMessage(socket, ping.buffer as ArrayBuffer)
				}
				expect((yield* ada.seen()).status).toBe("online")
			}),
		))

	it("a socket adopted before sessions existed is closed so its client reconnects", () =>
		run(
			Effect.gen(function* () {
				const sim = yield* makePresenceSim
				const ada = yield* sim.user("ada")
				const user = yield* ada.object
				const socket = makeFakeSocket()
				expect(yield* user.adopt(socket, { userId: ada.id as UserId, expiresAt: null })).toBe(
					"accepted",
				)
				// What such a socket's attachment looks like: no `session`.
				const { session: _session, ...older } = socket.deserializeAttachment() as Record<
					string,
					unknown
				>
				socket.serializeAttachment(older)
				yield* user.onMessage(socket, JSON.stringify({ _tag: "Ping" }))
				expect(socket.closed).toEqual({ code: 1012, reason: "presence_session_required" })
			}),
		))

	describe("older clients", () => {
		it("their socket and heartbeat RPC count as a web session", () =>
			run(
				Effect.gen(function* () {
					const sim = yield* makePresenceSim
					const ada = yield* sim.user("ada")
					const old = ada.device("web")
					yield* old.open({ legacy: true })
					yield* ada.legacyHeartbeat
					expect(yield* ada.seen()).toMatchObject({ status: "online", webStatus: "online" })
					yield* old.close
					// The heartbeat's own session outlives the socket until its timeout.
					yield* sim.advance(SESSION_TIMEOUT_MS + seconds(1))
					expect((yield* ada.seen()).status).toBe("offline")
				}),
			))

		it("their AFK away makes their sessions idle and AFK, and busy picks dnd", () =>
			run(
				Effect.gen(function* () {
					const sim = yield* makePresenceSim
					const ada = yield* sim.user("ada")
					yield* ada.device("web").open({ legacy: true })
					yield* ada.legacyUpdate({ status: "away" })
					expect(yield* ada.seen()).toMatchObject({ status: "away", afk: true })
					yield* ada.legacyUpdate({ status: "online" })
					expect(yield* ada.seen()).toMatchObject({ status: "online", afk: false })
					yield* ada.legacyUpdate({ status: "busy" })
					expect((yield* ada.seen()).status).toBe("dnd")
					expect((yield* ada.picked)?.status).toBe("dnd")
				}),
			))

		it("never undo invisible, and their idling never touches a newer client's session", () =>
			run(
				Effect.gen(function* () {
					const sim = yield* makePresenceSim
					const ada = yield* sim.user("ada")
					const fresh = ada.device("desktop")
					yield* fresh.open()
					yield* ada.device("web").open({ legacy: true })
					yield* ada.legacyUpdate({ status: "away" })
					expect(yield* ada.seen()).toMatchObject({
						status: "online",
						desktopStatus: "online",
						webStatus: "away",
					})
					yield* ada.pick("invisible")
					for (const status of ["online", "busy", "dnd"]) {
						yield* ada.legacyUpdate({ status })
						expect((yield* ada.seen()).status).toBe("offline")
						expect((yield* ada.picked)?.status).toBe("invisible")
					}
				}),
			))
	})
})
