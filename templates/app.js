/* Client-side behaviour for a viz page.
   Vanilla JS on purpose: no build step, no framework, readable a year from now.

   window.VIZ is injected by render.ts and holds page, decision, and theme data. */

(function () {
	const { mode, submitUrl, decideIds, theme, themeMode, themes } = window.VIZ;
	const answers = {};

	const bar = document.querySelector(".bar-inner");
	const progress = bar.querySelector(".progress");
	const submitBtn = bar.querySelector("button.primary");
	const nextBtn = bar.querySelector("button.next-unanswered");
	const themeSelect = bar.querySelector(".theme-control select");
	const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
	let activeTheme = theme;
	let activeMode = document.documentElement.dataset.themeMode;
	let followsSystem = themeMode === "system";
	let mermaidQueue = Promise.resolve();

	function themeMetadata(name) {
		return themes.find((candidate) => candidate.name === name);
	}

	function systemAppearance() {
		return colorScheme.matches ? "dark" : "light";
	}

	function appearanceFor(metadata, preferred) {
		if (metadata.appearances.includes(preferred)) return preferred;
		if (metadata.appearances.includes("independent")) return "independent";
		if (metadata.colorMode === "system") return systemAppearance();
		if (metadata.appearances.includes(metadata.colorMode)) return metadata.colorMode;
		return metadata.appearances[0];
	}

	function mermaidTheme(name, mode) {
		const metadata = themeMetadata(name);
		const configured = metadata ? metadata.mermaidTheme : "default";
		if (configured === "system") return mode === "dark" ? "dark" : "default";
		return configured;
	}

	async function redrawMermaid(name) {
		const mermaid = window.VIZ_MERMAID;
		const nodes = Array.from(document.querySelectorAll(".mermaid"));
		if (!mermaid || nodes.length === 0) return;

		const snapshots = nodes.map((node) => ({
			node,
			html: node.innerHTML,
			processed: node.hasAttribute("data-processed"),
		}));
		try {
			mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: mermaidTheme(name, activeMode) });
			for (const node of nodes) {
				node.removeAttribute("data-processed");
				node.textContent = node.dataset.source;
			}
			await mermaid.run({ nodes });
		} catch (_error) {
			// A theme change should never destroy a diagram that was already useful.
			for (const snapshot of snapshots) {
				snapshot.node.innerHTML = snapshot.html;
				snapshot.node.toggleAttribute("data-processed", snapshot.processed);
			}
		}
	}

	function queueMermaidRedraw() {
		mermaidQueue = mermaidQueue.catch(() => undefined).then(() => redrawMermaid(activeTheme));
	}

	function applyTheme(name, mode, followSystem = false) {
		activeTheme = name;
		activeMode = mode;
		followsSystem = followSystem;
		document.documentElement.dataset.theme = name;
		document.documentElement.dataset.themeMode = mode;
		themeSelect.value = `${name}:${mode}`;
		queueMermaidRedraw();
	}

	themeSelect.value = `${activeTheme}:${activeMode}`;
	themeSelect.addEventListener("change", () => {
		if (themeSelect.value === "__surprise__") {
			const alternatives = themes.filter((candidate) => candidate.name !== activeTheme);
			const next = alternatives[Math.floor(Math.random() * alternatives.length)];
			if (next) {
				applyTheme(next.name, appearanceFor(next, activeMode));
			} else {
				themeSelect.value = `${activeTheme}:${activeMode}`;
			}
			return;
		}
		const [name, mode] = themeSelect.value.split(":");
		applyTheme(name, mode);
	});

	window.addEventListener("viz:mermaid-ready", queueMermaidRedraw);
	colorScheme.addEventListener("change", () => {
		if (followsSystem) applyTheme(activeTheme, colorScheme.matches ? "dark" : "light", true);
	});
	requestAnimationFrame(() => document.documentElement.classList.add("theme-ready"));

	function refresh() {
		if (!progress || !submitBtn) return;
		const done = Object.keys(answers).length;
		const total = decideIds.length;
		progress.innerHTML = `<strong>${done}</strong> of ${total} answered`;

		const complete = done >= total;
		const verb = mode === "detached" ? "Copy" : "Submit";
		submitBtn.disabled = done === 0;
		submitBtn.textContent = complete
			? mode === "detached" ? "Copy answers" : "Submit"
			: done > 0 ? `${verb} ${done} of ${total}` : `${verb} answered`;

		if (nextBtn) {
			nextBtn.hidden = complete;
			nextBtn.textContent = `Show next unanswered (${total - done})`;
		}
	}

	/* Open every <details> above a node. closest() only finds one ancestor, so
	   walk upward until there are none left. */
	function revealNext() {
		const pending = Array.from(document.querySelectorAll(".decide")).find(
			(card) => !answers[card.dataset.id],
		);
		if (!pending) return;

		let parent = pending.parentElement;
		while (parent) {
			if (parent.tagName === "DETAILS") parent.open = true;
			parent = parent.parentElement;
		}
		pending.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	/* A card's answer has two parts: the option picked, and an optional note
	   justifying it. They are tracked apart and joined only on the way out, so
	   typing a note never looks like an answer on its own. */
	const picks = {};
	const notes = {};

	function record(card, id) {
		const pick = picks[id];
		const note = notes[id];
		if (pick) {
			answers[id] = note ? `${pick} \u2014 context: ${note}` : pick;
		} else {
			// delete, not = "": refresh() counts keys, so a blank entry would read
			// as answered.
			delete answers[id];
		}
		card.classList.toggle("answered", Boolean(answers[id]));
		refresh();
	}

	function highlight(card, option) {
		Array.from(card.querySelectorAll(".option")).forEach((el) => {
			el.classList.remove("selected");
			el.dataset.checked = "false";
		});
		option.classList.add("selected");
		option.dataset.checked = "true";
	}

	Array.from(document.querySelectorAll(".decide")).forEach((card) => {
		// querySelectorAll returns a NodeList, not an Array. Array.from converts it
		// so the usual array methods work.
		const id = card.dataset.id;
		// Scoped selectors: a card now holds two textareas, and grabbing the wrong
		// one silently swaps the note with the free-text answer.
		const other = card.querySelector(".option textarea");
		const note = card.querySelector(".note textarea");

		Array.from(card.querySelectorAll('input[type="radio"]')).forEach((radio) => {
			radio.addEventListener("change", () => {
				highlight(card, radio.closest(".option"));

				if (radio.value === "__other__") {
					other.focus();
					// An empty "other" does not count as answered yet.
					picks[id] = other.value.trim();
				} else {
					picks[id] = radio.value;
				}
				record(card, id);
			});
		});

		if (other) {
			other.addEventListener("input", () => {
				const radio = card.querySelector('input[value="__other__"]');
				radio.checked = true;
				highlight(card, radio.closest(".option"));
				picks[id] = other.value.trim();
				record(card, id);
			});
		}

		if (note) {
			note.addEventListener("input", () => {
				notes[id] = note.value.trim();
				record(card, id);
			});
		}
	});

	// Format the answers the same way viz prints them to stdout, so the copy
	// button and the blocking path produce identical text.
	function asText() {
		return decideIds
			.filter((id) => answers[id])
			.map((id) => `${id}: ${answers[id]}`)
			.join("\n");
	}

	if (nextBtn) nextBtn.addEventListener("click", revealNext);

	if (submitBtn) {
		submitBtn.addEventListener("click", async () => {
			submitBtn.disabled = true;

			if (mode === "detached") {
				await navigator.clipboard.writeText(asText());
				submitBtn.textContent = "Copied — paste it back";
				setTimeout(refresh, 2500);
				return;
			}

			try {
				const response = await fetch(submitUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ answers }),
				});
				if (!response.ok) throw new Error(`answer submission failed (${response.status})`);
				document.body.innerHTML =
					'<div class="done-screen"><h1>Sent</h1><p>You can close this tab.</p></div>';
			} catch (_error) {
				submitBtn.disabled = false;
				submitBtn.textContent = "Failed — retry";
			}
		});
	}

	refresh();
})();
