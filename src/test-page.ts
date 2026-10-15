import type { Page } from "./schema.ts";

export const TEST_PAGE = {
	title: "viz test page",
	subtitle: "A representative page for checking content, decisions, diagrams, and themes",
	blocks: [
		{
			type: "md",
			text: "## Everything is connected\n\nThis page exercises the main viz building blocks in one place.",
		},
		{
			type: "cards",
			items: [
				{ title: "Renderer", badge: "approve", meta: "page generated" },
				{ title: "Theme", badge: "easy", meta: "switch modes below" },
				{ title: "Decision", badge: "nitpick", meta: "one sample question" },
			],
		},
		{
			type: "group",
			label: "Included checks",
			badge: "approve",
			meta: "content · interaction · layout",
			open: true,
			blocks: [{
				type: "md",
				text: "1. Read the rendered content.\n2. Switch the theme and mode.\n3. Select an answer and copy it.",
			}],
		},
		{
			type: "table",
			label: "Block coverage",
			columns: ["Block", "Purpose", "Status"],
			rows: [
				["Markdown", "Long-form context", "Rendered"],
				["Table", "Comparable facts", "Rendered"],
				["Decision", "Collect an answer", "Ready"],
			],
		},
		{
			type: "diagram",
			label: "Test flow",
			text: "flowchart LR\n  A[Render] --> B[Inspect]\n  B --> C{Looks good?}\n  C -->|yes| D[Done]\n  C -->|no| E[Adjust]",
		},
		{
			type: "decide",
			id: "result",
			severity: "nitpick",
			title: "How does this sample page look?",
			body: "This detached decision checks option selection and answer copying without blocking the terminal.",
			options: ["Looks good", "Needs adjustment"],
			recommend: "Looks good",
		},
	],
} satisfies Page;
