/* Client-side behaviour for a viz page.
   Vanilla JS on purpose: no build step, no framework, readable a year from now.

   window.VIZ is injected by render.ts and holds page, decision, and theme data. */

(function () {
	const { mode, submitUrl, decideIds, checklist, theme, themeMode, themes } = window.VIZ;
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
	let diagramViewer = null;

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

	function createDiagramViewer() {
		const figures = Array.from(document.querySelectorAll("figure.diagram"));
		if (figures.length === 0) return null;

		const dialog = document.createElement("dialog");
		dialog.className = "diagram-viewer";
		dialog.setAttribute("aria-label", "Diagram viewer");
		dialog.innerHTML = `<div class="diagram-viewer-bar">
			<strong class="diagram-viewer-title">Diagram</strong>
			<span class="diagram-zoom" aria-live="polite">100%</span>
			<button type="button" data-action="out" aria-label="Zoom out">−</button>
			<button type="button" data-action="fit">Fit</button>
			<button type="button" data-action="in" aria-label="Zoom in">+</button>
			<button type="button" data-action="close" aria-label="Close diagram viewer">Close</button>
		</div>
		<div class="diagram-viewport" tabindex="0" aria-label="Zoomable diagram. Drag to pan; use plus and minus keys to zoom.">
			<div class="diagram-canvas"></div>
		</div>`;
		document.body.append(dialog);

		const title = dialog.querySelector(".diagram-viewer-title");
		const zoomLabel = dialog.querySelector(".diagram-zoom");
		const viewport = dialog.querySelector(".diagram-viewport");
		const canvas = dialog.querySelector(".diagram-canvas");
		let origin = null;
		let svg = null;
		let originalStyle = null;
		let width = 1;
		let height = 1;
		let scale = 1;
		let x = 0;
		let y = 0;
		let drag = null;

		function paint() {
			if (!svg) return;
			svg.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
			zoomLabel.textContent = `${Math.round(scale * 100)}%`;
		}

		function fit() {
			if (!svg) return;
			const padding = 48;
			scale = Math.min((viewport.clientWidth - padding) / width, (viewport.clientHeight - padding) / height);
			scale = Math.max(0.02, Math.min(8, scale));
			x = (viewport.clientWidth - width * scale) / 2;
			y = (viewport.clientHeight - height * scale) / 2;
			paint();
		}

		function zoomAt(factor, clientX, clientY) {
			if (!svg) return;
			const rect = viewport.getBoundingClientRect();
			const pointX = clientX - rect.left;
			const pointY = clientY - rect.top;
			const next = Math.max(0.02, Math.min(8, scale * factor));
			const ratio = next / scale;
			x = pointX - (pointX - x) * ratio;
			y = pointY - (pointY - y) * ratio;
			scale = next;
			paint();
		}

		function zoomFromCenter(factor) {
			const rect = viewport.getBoundingClientRect();
			zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
		}

		function restore() {
			if (!origin || !svg) return;
			if (originalStyle === null) svg.removeAttribute("style");
			else svg.setAttribute("style", originalStyle);
			origin.parent.insertBefore(origin.node, origin.next);
			canvas.replaceChildren();
			origin = null;
			svg = null;
			drag = null;
		}

		function close() {
			if (dialog.open) dialog.close();
		}

		function open(figure) {
			const mermaid = figure.querySelector(".mermaid");
			const rendered = mermaid && mermaid.querySelector("svg");
			if (!rendered) return;

			origin = { node: mermaid, parent: mermaid.parentNode, next: mermaid.nextSibling };
			svg = rendered;
			originalStyle = svg.getAttribute("style");
			const box = svg.viewBox && svg.viewBox.baseVal;
			width = Math.max(1, box && box.width ? box.width : svg.getBoundingClientRect().width);
			height = Math.max(1, box && box.height ? box.height : svg.getBoundingClientRect().height);
			svg.style.width = `${width}px`;
			svg.style.height = `${height}px`;
			svg.style.maxWidth = "none";
			canvas.replaceChildren(mermaid);
			title.textContent = figure.querySelector("figcaption")?.textContent || "Diagram";
			dialog.showModal();
			requestAnimationFrame(() => {
				fit();
				viewport.focus();
			});
		}

		function prepare() {
			for (const figure of figures) {
				const mermaid = figure.querySelector(".mermaid");
				const button = figure.querySelector(".diagram-open");
				const ready = Boolean(mermaid && mermaid.querySelector("svg"));
				button.hidden = !ready;
				mermaid?.classList.toggle("diagram-preview-ready", ready);
				if (figure.dataset.viewerWired) continue;
				figure.dataset.viewerWired = "true";
				button.addEventListener("click", () => open(figure));
				mermaid.addEventListener("click", (event) => {
					if (!event.target.closest("a")) open(figure);
				});
			}
		}

		dialog.querySelector('[data-action="close"]').addEventListener("click", close);
		dialog.querySelector('[data-action="fit"]').addEventListener("click", fit);
		dialog.querySelector('[data-action="in"]').addEventListener("click", () => zoomFromCenter(1.25));
		dialog.querySelector('[data-action="out"]').addEventListener("click", () => zoomFromCenter(0.8));
		dialog.addEventListener("close", restore);
		viewport.addEventListener("dblclick", fit);
		viewport.addEventListener("wheel", (event) => {
			event.preventDefault();
			zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
		}, { passive: false });
		viewport.addEventListener("pointerdown", (event) => {
			drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x, y };
			viewport.setPointerCapture(event.pointerId);
			viewport.classList.add("dragging");
		});
		viewport.addEventListener("pointermove", (event) => {
			if (!drag || drag.pointerId !== event.pointerId) return;
			x = drag.x + event.clientX - drag.clientX;
			y = drag.y + event.clientY - drag.clientY;
			paint();
		});
		function endDrag(event) {
			if (!drag || drag.pointerId !== event.pointerId) return;
			drag = null;
			viewport.classList.remove("dragging");
		}
		viewport.addEventListener("pointerup", endDrag);
		viewport.addEventListener("pointercancel", endDrag);
		viewport.addEventListener("keydown", (event) => {
			if (event.key === "+" || event.key === "=") zoomFromCenter(1.25);
			else if (event.key === "-") zoomFromCenter(0.8);
			else if (event.key === "0" || event.key.toLowerCase() === "f") fit();
			else return;
			event.preventDefault();
		});

		prepare();
		return { close, prepare };
	}

	async function redrawMermaid(name) {
		diagramViewer?.close();
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
			diagramViewer?.prepare();
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

	diagramViewer = createDiagramViewer();

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

	if (checklist) {
		Array.from(document.querySelectorAll(".checklist-toggle")).forEach((checkbox) => {
			checkbox.addEventListener("click", (event) => {
				// Do not let a checkbox click reach its <summary>, whose default
				// action would also expand or collapse the group.
				event.stopPropagation();
			});
			checkbox.addEventListener("change", () => {
				checkbox.closest(".checklist-item").classList.toggle("done", checkbox.checked);
			});
		});
	}

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
			(card) => !answers[card.dataset.id] && !card.closest(".group.done"),
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
