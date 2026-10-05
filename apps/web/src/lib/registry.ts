import { scheduleTask } from "@effect/atom-react"
import { Atom, AtomRegistry } from "effect/reactivity"
import { runtimeLayer, sharedMemoMap } from "./services/common/runtime"

export const appRegistry = AtomRegistry.make({ scheduleTask })

const sharedAtomRuntime = Atom.context({ memoMap: sharedMemoMap })(runtimeLayer)

appRegistry.mount(sharedAtomRuntime)
