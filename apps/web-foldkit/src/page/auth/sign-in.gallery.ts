import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../styles.css"
import type { OrganizationExport } from "@hazel/domain/models"
import type { OrganizationExportId, OrganizationId, UserId } from "@hazel/schema"
import { Option } from "effect"
import { Runtime } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { makeShared } from "../../test/pages-fixtures"
import { exportDataCard } from "../settings/general/export-data"
import * as GeneralMessage from "../settings/general/message"
import * as GeneralModel from "../settings/general/model"
import { init as initGeneral } from "../settings/general/update"
import * as SignInMessage from "./sign-in/message"
import { Methods, Model, type ServerChoice } from "./sign-in/model"
import { initWith } from "./sign-in/update"
import { view } from "./sign-in/view"

/**
 * Customer installs, rendered in light and dark (`bun run gallery`): the sign-in page with only the
 * install's providers (both, Google only, loading), the native app's "signing in to" line and its
 * change-server form, and the general settings' "Export data" card (running and ready).
 */

const signedOut = makeShared({ auth: "SignedOut", currentUser: null, organization: null, member: null })

const route = { _tag: "SignIn", redirectUrl: Option.none(), error: Option.none() } as const

const SIGN_IN_STATES = {
	"both-providers": {
		methods: Methods.Ready({ providers: ["github", "google"], passkeys: true }),
		server: null,
	},
	"google-only": { methods: Methods.Ready({ providers: ["google"], passkeys: true }), server: null },
	loading: { methods: Methods.Loading(), server: null },
	"native-customer-server": {
		methods: Methods.Ready({ providers: ["github", "google"], passkeys: true }),
		server: { label: "chat.acme.com", isDefault: false, form: null },
	},
	"native-change-server": {
		methods: Methods.Ready({ providers: ["github", "google"], passkeys: true }),
		server: {
			label: "hazel.sh",
			isDefault: true,
			form: { address: "acme.com", isBusy: false, problem: "NotHazel" },
		},
	},
} satisfies Record<string, { methods: Methods; server: ServerChoice | null }>

type SignInState = keyof typeof SIGN_IN_STATES

const signInModel = (state: SignInState): Model => ({
	...initWith(route, SIGN_IN_STATES[state].server).model,
	methods: SIGN_IN_STATES[state].methods,
})

const mount = () => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	return container
}

const renderSignIn = (state: SignInState) =>
	Runtime.run(
		Runtime.makeElement({
			Model,
			init: () => ({ model: signInModel(state) }),
			update: (model: Model) => ({ model }),
			view: (model: Model, h: HtmlBuilder<SignInMessage.Message>) =>
				h.div(
					[h.Id("gallery"), h.Class("h-[640px] w-[1180px] bg-bg text-fg")],
					[view(model, { shared: signedOut }, h)],
				),
			container: mount(),
		}),
	)

const NOW = Date.UTC(2026, 10, 23, 12)

const exportRow = (overrides: Partial<OrganizationExport.Type>): OrganizationExport.Type => ({
	id: "6f1c1b62-3e1f-4f6e-8f0a-9a1d2c3b4e5f" as OrganizationExportId,
	organizationId: "0b8c1d2e-3f4a-4b5c-8d6e-7f8091a2b3c4" as OrganizationId,
	requestedBy: "1d2c3b4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e" as UserId,
	status: "ready",
	channelCount: 24,
	channelsDone: 24,
	partCount: 3,
	rowCount: 48_213,
	byteSize: 18_400_000,
	error: null,
	createdAt: new Date(NOW - 3_600_000),
	updatedAt: null,
	completedAt: new Date(NOW - 3_000_000),
	expiresAt: new Date(NOW + 6 * 86_400_000),
	...overrides,
})

const EXPORT_STATES = {
	running: [exportRow({ status: "running", channelsDone: 9, rowCount: 17_890, completedAt: null })],
	ready: [exportRow({})],
} satisfies Record<string, ReadonlyArray<OrganizationExport.Type>>

type ExportState = keyof typeof EXPORT_STATES

const renderExport = (state: ExportState) => {
	const base = initGeneral({ _tag: "SettingsGeneral", orgSlug: "hazel" }, makeShared()).model
	const model: GeneralModel.Model = { ...base, exports: EXPORT_STATES[state] }
	Runtime.run(
		Runtime.makeElement({
			Model: GeneralModel.Model,
			init: () => ({ model }),
			update: (current: GeneralModel.Model) => ({ model: current }),
			view: (current: GeneralModel.Model, h: HtmlBuilder<GeneralMessage.Message>) =>
				h.div(
					[h.Id("gallery"), h.Class("w-[720px] bg-bg p-6 text-fg")],
					[exportDataCard(h, current, NOW)],
				),
			container: mount(),
		}),
	)
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const shoot = async (path: string) => {
	await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
	await new Promise((resolve) => setTimeout(resolve, 200))
	await document.fonts.ready
	const gallery = document.getElementById("gallery")
	if (gallery === null) throw new Error("The gallery did not render")
	await page.screenshot({ path, element: gallery })
}

for (const theme of ["light", "dark"] as const) {
	for (const state of Object.keys(SIGN_IN_STATES) as Array<SignInState>) {
		test(`sign-in ${state} ${theme}`, async () => {
			if (theme === "dark") document.documentElement.classList.add("dark")
			renderSignIn(state)
			await shoot(`sign-in-${state}-${theme}.png`)
		})
	}
	for (const state of Object.keys(EXPORT_STATES) as Array<ExportState>) {
		test(`export ${state} ${theme}`, async () => {
			if (theme === "dark") document.documentElement.classList.add("dark")
			renderExport(state)
			await shoot(`export-${state}-${theme}.png`)
		})
	}
}
