export type ThemeAppearance = "light" | "dark" | "independent";
export type ThemeColorMode = ThemeAppearance | "system";
export type MermaidTheme = "default" | "dark" | "system";

export interface Theme {
	name: string;
	description: string;
	/** The appearance used when this named theme first opens. */
	colorMode: ThemeColorMode;
	/** Concrete appearances offered by the in-page theme selector. */
	appearances: readonly ThemeAppearance[];
	mermaidTheme: MermaidTheme;
	stylesheet: string;
	/** Number of curated artwork arrangements available to this theme. */
	artVariants?: number;
}

export const THEMES: readonly Theme[] = [
	{
		name: "classic",
		description: "The original quiet, focused viz design",
		colorMode: "system",
		appearances: ["light", "dark"],
		mermaidTheme: "system",
		stylesheet: "classic.css",
	},
	{
		name: "storybook",
		description: "Warm paper, violet ink, and a little narrative sparkle",
		colorMode: "system",
		appearances: ["light", "dark"],
		mermaidTheme: "system",
		stylesheet: "storybook.css",
	},
	{
		name: "unicorn",
		description: "Pastel rainbows, candy-colored cards, and one tiny unicorn",
		colorMode: "system",
		appearances: ["light", "dark"],
		mermaidTheme: "system",
		stylesheet: "unicorn.css",
	},
	{
		name: "arcade",
		description: "A neon cabinet for shipping software at high score",
		colorMode: "system",
		appearances: ["light", "dark"],
		mermaidTheme: "system",
		stylesheet: "arcade.css",
	},
	{
		name: "rainbow",
		description: "Bold color fields that give every content block its own stage",
		colorMode: "independent",
		appearances: ["independent"],
		mermaidTheme: "default",
		stylesheet: "rainbow.css",
	},
	{
		name: "zine",
		description: "Photocopied punk collage with fluorescent cut-paper blocks",
		colorMode: "independent",
		appearances: ["independent"],
		mermaidTheme: "default",
		stylesheet: "zine.css",
	},
	{
		name: "high-fantasy",
		description: "An emerald road through old maps, golden halls, and cheerful quests",
		colorMode: "independent",
		appearances: ["independent"],
		mermaidTheme: "default",
		stylesheet: "high-fantasy.css",
		artVariants: 5,
	},
	{
		name: "adventurer-handbook",
		description: "An ink-and-parchment adventurer's manual with red rulebook accents",
		colorMode: "independent",
		appearances: ["independent"],
		mermaidTheme: "default",
		stylesheet: "adventurer-handbook.css",
		artVariants: 6,
	},
	{
		name: "inferno",
		description: "Charred cathedral stone, blood-red glass, and living embers",
		colorMode: "independent",
		appearances: ["independent"],
		mermaidTheme: "dark",
		stylesheet: "inferno.css",
	},
	{
		name: "dark-cathedral",
		description: "A grim reliquary of iron, bone, blood-red glass, and forbidden rites",
		colorMode: "independent",
		appearances: ["independent"],
		mermaidTheme: "dark",
		stylesheet: "dark-cathedral.css",
		artVariants: 6,
	},
	{
		name: "swamp",
		description: "A muddy fairy-tale swamp of onions, crooked signs, and ogre-green cheer",
		colorMode: "independent",
		appearances: ["independent"],
		mermaidTheme: "default",
		stylesheet: "swamp.css",
		artVariants: 6,
	},
	{
		name: "space-command",
		description: "Deep-space command deck with cyan tactical readouts",
		colorMode: "independent",
		appearances: ["independent"],
		mermaidTheme: "dark",
		stylesheet: "space-command.css",
	},
	{
		name: "light-side",
		description: "Hopeful temple stone, distant horizons, and luminous blue starlight",
		colorMode: "system",
		appearances: ["light", "dark"],
		mermaidTheme: "system",
		stylesheet: "light-side.css",
		artVariants: 4,
	},
	{
		name: "dark-side",
		description: "Severe command architecture, cold steel, and disciplined red light",
		colorMode: "system",
		appearances: ["light", "dark"],
		mermaidTheme: "system",
		stylesheet: "dark-side.css",
		artVariants: 4,
	},
];

export type ThemeChoice = string;

const RANDOM_CHOICES = ["random", "random_light", "random_dark", "random_system"] as const;

export function validThemeChoices(): string[] {
	return [...THEMES.map((theme) => theme.name), ...RANDOM_CHOICES];
}

export function validateThemeChoice(value: string): ThemeChoice {
	const choice = value.trim().toLowerCase();
	if (RANDOM_CHOICES.some((candidate) => candidate === choice)) return choice;
	if (THEMES.some((theme) => theme.name === choice)) return choice;
	throw new Error(`unknown theme ${JSON.stringify(value)}; choose ${validThemeChoices().join(", ")}`);
}

function randomTheme(themes: readonly Theme[], random: () => number): Theme {
	return themes[Math.floor(random() * themes.length)] ?? themes[0] ?? THEMES[0];
}

export function resolveTheme(choice: ThemeChoice, random: () => number = Math.random): Theme {
	const validated = validateThemeChoice(choice);
	if (!RANDOM_CHOICES.some((candidate) => candidate === validated)) {
		const theme = THEMES.find((candidate) => candidate.name === validated);
		if (theme) return theme;
		throw new Error(`theme registry is missing ${JSON.stringify(validated)}`);
	}

	if (validated === "random_light" || validated === "random_dark") {
		const appearance = validated === "random_light" ? "light" : "dark";
		const candidates = THEMES.filter((theme) => theme.appearances.includes(appearance));
		const theme = randomTheme(candidates, random);
		return {
			...theme,
			colorMode: appearance,
			mermaidTheme: appearance === "dark" ? "dark" : "default",
		};
	}

	if (validated === "random_system") {
		const candidates = THEMES.filter((theme) => theme.colorMode === "system");
		return randomTheme(candidates, random);
	}

	// Bare random includes every visual design and keeps the chosen theme's own
	// mode policy. This lets independent themes participate without pretending
	// to have light or dark variants.
	return randomTheme(THEMES, random);
}

export function themeByName(name: string): Theme {
	return resolveTheme(validateThemeChoice(name));
}
