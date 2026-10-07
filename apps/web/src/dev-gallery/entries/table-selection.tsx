import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "~/components/ui/table"
import { GallerySection } from "../frame"

export const title = "Table selection"

const members = [
	{ id: "ada", name: "Ada Lovelace", role: "Owner" },
	{ id: "grace", name: "Grace Hopper", role: "Admin" },
	{ id: "alan", name: "Alan Turing", role: "Member" },
	{ id: "katherine", name: "Katherine Johnson", role: "Guest" },
]

export function Gallery() {
	return (
		<GallerySection title="Checkbox selection">
			<Table
				aria-label="Invite members"
				selectionMode="multiple"
				selectionBehavior="toggle"
				defaultSelectedKeys={["grace"]}
				disabledKeys={["katherine"]}
				className="w-[32rem]"
			>
				<TableHeader>
					<TableColumn isRowHeader>Name</TableColumn>
					<TableColumn>Role</TableColumn>
				</TableHeader>
				<TableBody>
					{members.map((member) => (
						<TableRow key={member.id} id={member.id}>
							<TableCell>{member.name}</TableCell>
							<TableCell>{member.role}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</GallerySection>
	)
}
