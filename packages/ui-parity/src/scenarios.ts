import type { Dataset } from "./fixtures/dataset.ts"
import { defaultDataset } from "./fixtures/datasets/default.ts"
import { chatArea } from "./scenarios/chat.ts"
import { chatListArea } from "./scenarios/chat-list.ts"
import { entryArea } from "./scenarios/entry.ts"
import { galleryArea } from "./scenarios/gallery.ts"
import { homeArea } from "./scenarios/home.ts"
import { integrationsArea } from "./scenarios/integrations.ts"
import { mySettingsArea } from "./scenarios/my-settings.ts"
import { navigationArea } from "./scenarios/navigation.ts"
import { notificationsArea } from "./scenarios/notifications.ts"
import { settingsArea } from "./scenarios/settings.ts"
import type { AreaModule, RpcHandlers, Scenario } from "./scenarios/types.ts"

export * from "./scenarios/types.ts"

/** Every area module. Scenarios live in `src/scenarios/<area>.ts`; only this list is shared. */
const areas: ReadonlyArray<AreaModule> = [
	chatArea,
	chatListArea,
	navigationArea,
	notificationsArea,
	settingsArea,
	integrationsArea,
	mySettingsArea,
	homeArea,
	entryArea,
	galleryArea,
]

const uniqueBy = <A>(items: ReadonlyArray<A>, key: (item: A) => string, kind: string) => {
	const seen = new Set<string>()
	for (const item of items) {
		if (seen.has(key(item))) throw new Error(`ui-parity: duplicate ${kind} "${key(item)}"`)
		seen.add(key(item))
	}
	return items
}

export const scenarios: ReadonlyArray<Scenario> = uniqueBy(
	areas.flatMap((area) => area.scenarios),
	(scenario) => scenario.id,
	"scenario",
)

export const datasets: ReadonlyMap<string, Dataset> = new Map(
	uniqueBy(
		[defaultDataset, ...areas.flatMap((area) => area.datasets ?? [])],
		(dataset) => dataset.name,
		"dataset",
	).map((dataset) => [dataset.name, dataset]),
)

for (const scenario of scenarios)
	if (scenario.dataset && !datasets.has(scenario.dataset))
		throw new Error(`ui-parity: scenario "${scenario.id}" uses unknown dataset "${scenario.dataset}"`)

/** Area-level canned RPCs for a dataset, merged in area order. */
export const areaRpcHandlers = (dataset: Dataset): RpcHandlers =>
	Object.assign({}, ...areas.map((area) => area.rpc?.(dataset) ?? {}))
