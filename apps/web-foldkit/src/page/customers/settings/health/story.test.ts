import * as Customers from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerSettingsId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import type { Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { sharedDefaults } from "../../../test-shared"
import * as Slider from "../../../../ui/slider"
import { DelayHealthPreview, FetchHealthCheckDetail, FetchHealthDryRun, SaveHealthSettings } from "./commands"
import { Message } from "./message"
import { invalidFieldsOf, isDirty, type Model, scaledWeights, validDraftOf, weightTotal } from "./model"
import { init, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the health settings: weights, bands, the debounced dry run, save and discard. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const settingsId = Schema.decodeSync(CustomerSettingsId)(uuid(2))
const accountId = Schema.decodeSync(CustomerAccountId)(uuid(3))

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: Schema.decodeSync(UserId)(uuid(4)),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(5)), role: "admin" },
	nowMs: Date.UTC(2026, 10, 10, 12),
	...sharedDefaults,
}

const DEFAULTS = Customers.DEFAULT_HEALTH_SETTINGS
const pageUpdate = (current: Model, next: Message) => update(current, next, shared)

const loaded = (): Model =>
	pageUpdate(
		init().model,
		Message.UpdatedSettings({ settings: { id: settingsId, health: DEFAULTS, reportingCurrency: "USD" } }),
	).model

const weight = (key: Customers.HealthComponentKey, value: number) => Message.ChangedWeight({ key, value })

const result = (moved: number): Customers.HealthDryRunResult => ({
	current: [{ status: "healthy", count: 10, mrrMinor: 1_000 }],
	proposed: [{ status: "healthy", count: 10 - moved, mrrMinor: 1_000 }],
	transitions: [{ from: "healthy", to: "at_risk", count: moved }],
	samples: [
		{
			accountId,
			name: "Acme",
			current: { score: 72, status: "healthy", components: [] },
			proposed: { score: 64, status: "at_risk", components: [] },
		},
	],
})

describe("health settings: weights", () => {
	test("an edit makes a draft; the total and validity follow it", () => {
		const over = pageUpdate(loaded(), weight("usage", 45)).model
		expect(isDirty(over)).toBe(true)
		expect(over.draft?.weights.usage).toBe(45)
		expect(weightTotal(over.draft ?? DEFAULTS)).toBe(110)
		expect(validDraftOf(over)).toBeNull()
		expect(over.lastWeight).toBe("usage")

		const balanced = pageUpdate(over, weight("engagement", 15)).model
		expect(weightTotal(balanced.draft ?? DEFAULTS)).toBe(100)
		expect(validDraftOf(balanced)).not.toBeNull()
	})

	test("moving a weight back to its saved value leaves no draft", () => {
		const back = [weight("usage", 40), weight("usage", 35)].reduce(
			(current, next) => pageUpdate(current, next).model,
			loaded(),
		)
		expect(back.draft).toBeNull()
		expect(isDirty(back)).toBe(false)
	})

	test("over 100 blocks saving and the dry run", () => {
		const over = pageUpdate(loaded(), weight("usage", 45))
		expect(over.commands ?? []).toHaveLength(0)
		expect(over.model.preview.result._tag).toBe("Idle")
		expect(pageUpdate(over.model, Message.PressedSave()).commands ?? []).toHaveLength(0)
		expect(
			pageUpdate(over.model, Message.ElapsedHealthPreviewDelay({ version: over.model.preview.version }))
				.commands ?? [],
		).toHaveLength(0)
	})

	test("Scale to 100% keeps the proportions and sums to exactly 100", () => {
		expect(scaledWeights({ usage: 45, engagement: 25, billing: 25, signals: 15 })).toEqual({
			usage: 41,
			engagement: 23,
			billing: 23,
			signals: 13,
		})
		expect(scaledWeights({ usage: 1, engagement: 1, billing: 1, signals: 0 })).toEqual({
			usage: 34,
			engagement: 33,
			billing: 33,
			signals: 0,
		})
		expect(scaledWeights({ usage: 0, engagement: 0, billing: 0, signals: 0 })).toEqual({
			usage: 25,
			engagement: 25,
			billing: 25,
			signals: 25,
		})
		const scaled = pageUpdate(
			pageUpdate(loaded(), weight("usage", 45)).model,
			Message.PressedScaleWeights(),
		)
		expect(weightTotal(scaled.model.draft ?? DEFAULTS)).toBe(100)
		expect(scaled.model.lastWeight).toBeNull()
		expect(scaled.commands?.[0]?.name).toBe(DelayHealthPreview.name)
	})
})

describe("health settings: bands and steps", () => {
	test("band handles keep at risk below healthy", () => {
		const handle = (id: "healthyMin" | "atRiskMin", direction: "Min" | "Max", value: number) =>
			Message.GotSliderMessage({
				id,
				message: Slider.Message.PressedKeyboardNavigation({ direction, value }),
			})
		const atRisk = pageUpdate(loaded(), handle("atRiskMin", "Max", 40)).model
		expect(atRisk.draft?.bands).toEqual({ healthyMin: 70, atRiskMin: 69 })
		const healthy = pageUpdate(loaded(), handle("healthyMin", "Min", 70)).model
		expect(healthy.draft?.bands).toEqual({ healthyMin: 41, atRiskMin: 40 })
	})

	test("typed bands may cross, and then the draft is invalid", () => {
		const crossed = pageUpdate(loaded(), Message.ChangedBand({ band: "atRiskMin", value: 80 })).model
		expect(invalidFieldsOf(crossed.draft ?? DEFAULTS)).toEqual(new Set(["healthyMin", "atRiskMin"]))
		expect(validDraftOf(crossed)).toBeNull()
	})

	test("steps out of order or out of range are flagged", () => {
		const unordered = pageUpdate(
			loaded(),
			Message.ChangedStep({ list: "daysSinceActive", index: 1, field: "threshold", value: 0 }),
		).model
		expect(invalidFieldsOf(unordered.draft ?? DEFAULTS).has("daysSinceActive.1.threshold")).toBe(true)
		const tooHigh = pageUpdate(
			loaded(),
			Message.ChangedStep({ list: "trend", index: 0, field: "score", value: 120 }),
		).model
		expect(invalidFieldsOf(tooHigh.draft ?? DEFAULTS).has("trend.0.score")).toBe(true)
		const emptied = pageUpdate(
			loaded(),
			Message.ChangedScore({ field: "pastDue", value: Number.NaN }),
		).model
		expect(invalidFieldsOf(emptied.draft ?? DEFAULTS).has("pastDue")).toBe(true)
		expect(validDraftOf(emptied)).toBeNull()
		const ratio = pageUpdate(
			loaded(),
			Message.ChangedStep({ list: "activeRatio", index: 0, field: "threshold", value: 0.5 }),
		).model
		expect(validDraftOf(ratio)?.steps.usage.activeRatio[0]).toEqual({ min: 0.5, score: 100 })
	})
})

describe("health settings: preview", () => {
	test("only the latest draft's dry run applies", () => {
		const first = pageUpdate(loaded(), weight("usage", 40))
		const firstVersion = first.model.preview.version
		const second = pageUpdate(
			pageUpdate(first.model, weight("engagement", 20)).model,
			weight("usage", 40),
		)
		const latest = second.model.preview.version
		expect(latest).toBeGreaterThan(firstVersion)
		expect(second.model.preview.result._tag).toBe("Loading")

		// The first delay elapses after a newer edit: nothing is fetched.
		expect(
			pageUpdate(second.model, Message.ElapsedHealthPreviewDelay({ version: firstVersion })).commands ??
				[],
		).toHaveLength(0)

		const fetched = pageUpdate(second.model, Message.ElapsedHealthPreviewDelay({ version: latest }))
		expect(fetched.commands?.[0]).toMatchObject({
			name: FetchHealthDryRun.name,
			args: {
				organizationId,
				version: latest,
				draft: { ...DEFAULTS, weights: { ...DEFAULTS.weights, usage: 40, engagement: 20 } },
			},
		})

		const stale = pageUpdate(
			second.model,
			Message.SucceededFetchHealthDryRun({ version: firstVersion, result: result(1) }),
		).model
		expect(stale.preview.result._tag).toBe("Loading")
	})

	test("an answer settles the preview and picks its first sample to check", () => {
		story(
			pageUpdate,
			given(pageUpdate(loaded(), weight("usage", 40)).model),
			message(weight("engagement", 20)),
			model((current) => expect(current.preview.result._tag).toBe("Loading")),
			Command.resolve(DelayHealthPreview, Message.ElapsedHealthPreviewDelay({ version: 2 })),
			Command.resolve(
				FetchHealthDryRun,
				Message.SucceededFetchHealthDryRun({ version: 2, result: result(1) }),
			),
			model((current) => {
				expect(current.preview.result._tag).toBe("Success")
				expect(current.check?.accountId).toBe(accountId)
			}),
			Command.resolve(
				FetchHealthCheckDetail,
				Message.SucceededFetchHealthCheckDetail({ accountId, health: null }),
			),
			model((current) => expect(current.check?.saved._tag).toBe("Success")),
		)
	})
})

describe("health settings: save, discard, reset", () => {
	test("save sends the draft and toasts on success", () => {
		const draft = { ...DEFAULTS, weights: { ...DEFAULTS.weights, usage: 40, engagement: 20 } }
		const edited = [weight("usage", 40), weight("engagement", 20)].reduce(
			(current, next) => pageUpdate(current, next).model,
			loaded(),
		)
		const saving = pageUpdate(edited, Message.PressedSave())
		expect(saving.model.isSaving).toBe(true)
		expect(saving.commands?.[0]).toMatchObject({
			name: SaveHealthSettings.name,
			args: { organizationId, settingsId, health: draft },
		})
		// The optimistic row syncs first: the draft stays until the save settles.
		const synced = pageUpdate(
			saving.model,
			Message.UpdatedSettings({
				settings: { id: settingsId, health: draft, reportingCurrency: "USD" },
			}),
		).model
		expect(synced.draft).not.toBeNull()
		story(
			pageUpdate,
			given(synced),
			message(Message.SucceededSaveHealthSettings()),
			model((current) => {
				expect(current.isSaving).toBe(false)
				expect(current.draft).toBeNull()
			}),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "Health score saved",
						description: "Customers are rescored on the next compute.",
					},
				}),
			),
		)
	})

	test("a failed save keeps the draft", () => {
		const edited = pageUpdate(
			pageUpdate(loaded(), weight("usage", 40)).model,
			weight("engagement", 20),
		).model
		const saving = pageUpdate(edited, Message.PressedSave()).model
		const failed = pageUpdate(saving, Message.FailedSaveHealthSettings({ reason: "Offline" }))
		expect(failed.model.isSaving).toBe(false)
		expect(isDirty(failed.model)).toBe(true)
		expect(failed.outMessage?._tag).toBe("RequestedToast")
	})

	test("discard drops the draft and the preview", () => {
		const edited = pageUpdate(loaded(), weight("usage", 45)).model
		const discarded = pageUpdate(edited, Message.PressedDiscard()).model
		expect(discarded.draft).toBeNull()
		expect(discarded.lastWeight).toBeNull()
		expect(discarded.preview.result._tag).toBe("Idle")
	})

	test("reset to defaults puts the defaults in the draft", () => {
		const custom = { ...DEFAULTS, bands: { healthyMin: 75, atRiskMin: 45 } }
		const saved = pageUpdate(
			init().model,
			Message.UpdatedSettings({
				settings: { id: settingsId, health: custom, reportingCurrency: "USD" },
			}),
		).model
		const reset = pageUpdate(saved, Message.PressedResetDefaults())
		expect(reset.model.draft).toEqual(DEFAULTS)
		expect(reset.commands?.[0]?.name).toBe(DelayHealthPreview.name)
	})
})
