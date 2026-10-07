import { useState } from "react"
import type { SortDescriptor } from "react-aria-components"
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "~/components/ui/table"
import { GallerySection } from "../frame"

export const title = "Table"

const members = [
	{ id: "ada", name: "Ada Lovelace", role: "Owner", channels: 12 },
	{ id: "grace", name: "Grace Hopper", role: "Admin", channels: 7 },
	{ id: "alan", name: "Alan Turing", role: "Member", channels: 3 },
	{
		id: "katherine",
		name: "Katherine Johnson with a much longer display name",
		role: "Guest",
		channels: 1,
	},
]

type Member = (typeof members)[number]

function MemberRows({ rows, disabledKeys }: { rows: ReadonlyArray<Member>; disabledKeys?: Array<string> }) {
	return (
		<TableBody>
			{rows.map((member) => (
				<TableRow key={member.id} id={member.id} isDisabled={disabledKeys?.includes(member.id)}>
					<TableCell>{member.name}</TableCell>
					<TableCell>{member.role}</TableCell>
					<TableCell>{member.channels}</TableCell>
				</TableRow>
			))}
		</TableBody>
	)
}

function SortableTable() {
	const [sort, setSort] = useState<SortDescriptor>({ column: "name", direction: "ascending" })
	const rows = [...members].sort((a, b) => {
		const key = sort.column as "name" | "channels"
		const order = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0
		return sort.direction === "ascending" ? order : -order
	})
	return (
		<Table aria-label="Sortable members" sortDescriptor={sort} onSortChange={setSort}>
			<TableHeader>
				<TableColumn id="name" isRowHeader allowsSorting>
					Name
				</TableColumn>
				<TableColumn id="role">Role</TableColumn>
				<TableColumn id="channels" allowsSorting>
					Channels
				</TableColumn>
			</TableHeader>
			<MemberRows rows={rows} />
		</Table>
	)
}

function Header() {
	return (
		<TableHeader>
			<TableColumn isRowHeader>Name</TableColumn>
			<TableColumn>Role</TableColumn>
			<TableColumn>Channels</TableColumn>
		</TableHeader>
	)
}

export function Gallery() {
	return (
		<>
			<GallerySection title="Selectable">
				<Table
					aria-label="Members"
					selectionMode="single"
					selectionBehavior="replace"
					defaultSelectedKeys={["grace"]}
					className="w-[40rem]"
				>
					<Header />
					<MemberRows rows={members} disabledKeys={["alan"]} />
				</Table>
			</GallerySection>
			<GallerySection title="Sortable">
				<SortableTable />
			</GallerySection>
			<GallerySection title="Grid and striped">
				<Table aria-label="Grid members" grid>
					<Header />
					<MemberRows rows={members.slice(0, 2)} />
				</Table>
				<Table aria-label="Striped members" striped>
					<Header />
					<MemberRows rows={members.slice(0, 3)} />
				</Table>
			</GallerySection>
			<GallerySection title="Empty">
				<Table aria-label="No members" className="w-[30rem]">
					<Header />
					<TableBody renderEmptyState={() => <p className="py-6 text-center">No members yet</p>}>
						{[]}
					</TableBody>
				</Table>
			</GallerySection>
		</>
	)
}
