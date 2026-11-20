import { describe, expect, test, vi } from "vitest"
import { ISSUE_SLAS, ISSUES } from "../../lab/fixtures/issues"
import * as IssueControl from "./issue-control"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** The thread control's SLA row: kept for its own issue, dropped for another or when the issue goes. */

const context = { organizationId: null, currentUserId: null }

describe("issue control: SLA", () => {
	const issue = ISSUES[1]
	const sla = ISSUE_SLAS[1]
	const other = ISSUE_SLAS[2]
	if (issue === undefined || sla === undefined || other === undefined) throw new Error("No fixtures")
	const shown = IssueControl.update(
		IssueControl.init(issue.rootMessageId),
		IssueControl.Message.UpdatedIssue({ rootMessageId: issue.rootMessageId, issue }),
		context,
	).model

	test("the issue's own SLA row shows; another issue's is dropped", () => {
		const withSla = IssueControl.update(
			shown,
			IssueControl.Message.UpdatedSla({ issueId: issue.id, sla }),
			context,
		).model
		expect(withSla.sla).toEqual(sla)
		const stale = IssueControl.update(
			shown,
			IssueControl.Message.UpdatedSla({ issueId: other.id, sla: other }),
			context,
		).model
		expect(stale.sla).toBeNull()
	})

	test("the row goes with its issue", () => {
		const withSla = IssueControl.update(
			shown,
			IssueControl.Message.UpdatedSla({ issueId: issue.id, sla }),
			context,
		).model
		const gone = IssueControl.update(
			withSla,
			IssueControl.Message.UpdatedIssue({ rootMessageId: issue.rootMessageId, issue: null }),
			context,
		).model
		expect(gone.sla).toBeNull()
		const same = IssueControl.update(
			withSla,
			IssueControl.Message.UpdatedIssue({
				rootMessageId: issue.rootMessageId,
				issue: { ...issue, priority: "urgent" },
			}),
			context,
		).model
		expect(same.sla).toEqual(sla)
	})
})
