/** Re-exports `@hazel/client-data` (and the app's instance, `./client.ts`) at its old path. */
import { ChannelSnapshotsWeb } from "@hazel/client-data/web"

export const {
	MAX_KEPT_CHANNELS,
	makeAppChannelSnapshots,
	makeChannelSnapshots,
	openHostBackend,
	openIdbBackend,
} = ChannelSnapshotsWeb
export type { ChannelSnapshots, SnapshotBackend } from "@hazel/client-data/web/channel-snapshots"
