<script lang="ts">
	import { onMount } from 'svelte'
	import Icon from '$lib/components/Icon.svelte'

	export type PaletteItem = {
		id: string
		label: string
		hint?: string
		group?: string
		keywords?: string
		run: () => void
	}

	interface Props {
		open: boolean
		items: PaletteItem[]
		onClose: () => void
	}

	let { open = $bindable(false), items, onClose }: Props = $props()

	let query = $state('')
	let active = $state(0)
	let inputEl: HTMLInputElement | undefined = $state()
	let listEl: HTMLElement | undefined = $state()

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase()
		if (!q) return items
		return items.filter((it) => {
			const hay = `${it.label} ${it.hint ?? ''} ${it.group ?? ''} ${it.keywords ?? ''}`.toLowerCase()
			return hay.includes(q) || q.split(/\s+/).every((p) => hay.includes(p))
		})
	})

	$effect(() => {
		// reset highlight when filter changes
		void filtered
		active = 0
	})

	$effect(() => {
		if (open) {
			query = ''
			active = 0
			queueMicrotask(() => inputEl?.focus())
		}
	})

	function close(): void {
		open = false
		onClose()
	}

	function run(item: PaletteItem): void {
		close()
		// Defer so focus returns to page before action
		queueMicrotask(() => item.run())
	}

	function onKeydown(e: KeyboardEvent): void {
		if (!open) return
		if (e.key === 'Escape') {
			e.preventDefault()
			e.stopPropagation()
			close()
			return
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			if (!filtered.length) return
			active = (active + 1) % filtered.length
			scrollActive()
			return
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault()
			if (!filtered.length) return
			active = (active - 1 + filtered.length) % filtered.length
			scrollActive()
			return
		}
		if (e.key === 'Enter') {
			e.preventDefault()
			const item = filtered[active]
			if (item) run(item)
		}
	}

	function scrollActive(): void {
		const el = listEl?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
		el?.scrollIntoView({ block: 'nearest' })
	}

	onMount(() => {
		const onWin = (e: KeyboardEvent) => {
			if (!open) return
			// Keep palette keyboard handling even if focus slips
			if (e.key === 'Escape') {
				e.preventDefault()
				close()
			}
		}
		window.addEventListener('keydown', onWin, true)
		return () => window.removeEventListener('keydown', onWin, true)
	})
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="overlay" role="presentation" onclick={close} onkeydown={onKeydown}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="palette"
			role="dialog"
			aria-modal="true"
			aria-label="پالت دستورات"
			tabindex="-1"
			dir="rtl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={onKeydown}
		>
			<div class="search-row">
				<span class="search-icon" aria-hidden="true">
					<Icon name="magnifying-glass" size="1.15rem" />
				</span>
				<input
					bind:this={inputEl}
					bind:value={query}
					class="search"
					type="search"
					placeholder="جستجوی دستور، فصل، تم…"
					autocomplete="off"
					spellcheck="false"
					aria-autocomplete="list"
					aria-controls="cmd-list"
				/>
			</div>
			<ul id="cmd-list" class="list" role="listbox" bind:this={listEl}>
				{#each filtered as item, i (item.id)}
					<li role="option" aria-selected={i === active}>
						<button
							type="button"
							class="item"
							class:active={i === active}
							data-idx={i}
							onmouseenter={() => (active = i)}
							onclick={() => run(item)}
						>
							<div class="main">
								{#if item.group}
									<span class="group">{item.group}</span>
								{/if}
								<span class="label">{item.label}</span>
							</div>
							{#if item.hint}
								<span class="hint ltr">{item.hint}</span>
							{/if}
						</button>
					</li>
				{:else}
					<li class="empty">موردی پیدا نشد</li>
				{/each}
			</ul>
			<footer class="foot">
				<span><kbd>↑</kbd><kbd>↓</kbd> حرکت</span>
				<span><kbd>Enter</kbd> اجرا</span>
				<span><kbd>Esc</kbd> بستن</span>
			</footer>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: color-mix(in srgb, var(--bg) 55%, transparent);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 12vh 1rem 2rem;
	}

	.palette {
		width: min(560px, 100%);
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: var(--shadow-lg);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		max-height: min(70vh, 520px);
	}

	.search-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.75rem 0.9rem;
		border-bottom: 1px solid var(--border);
	}

	.search-icon {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--muted);
		line-height: 1;
	}

	.search {
		flex: 1;
		border: none;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 1.05rem;
		outline: none;
		min-width: 0;
	}

	.search::placeholder {
		color: var(--muted);
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0.35rem;
		overflow-y: auto;
		flex: 1 1 auto;
		min-height: 0;
	}

	.item {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		text-align: right;
		border: none;
		background: transparent;
		color: var(--text);
		padding: 0.55rem 0.7rem;
		border-radius: 9px;
		cursor: pointer;
		font: inherit;
	}

	.item:hover,
	.item.active {
		background: var(--accent-soft);
	}

	.item.active {
		outline: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
	}

	.main {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.group {
		font-size: 0.72rem;
		color: var(--muted);
	}

	.label {
		font-size: 0.95rem;
	}

	.hint {
		font-size: 0.75rem;
		color: var(--muted);
		font-family: var(--mono);
		flex-shrink: 0;
	}

	.empty {
		padding: 1.25rem;
		text-align: center;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		padding: 0.45rem 0.85rem;
		border-top: 1px solid var(--border);
		font-size: 0.75rem;
		color: var(--muted);
		background: var(--panel-2);
	}

	kbd {
		font-family: var(--mono);
		font-size: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
		margin-inline: 0.1rem;
		background: var(--bg);
	}

	.ltr {
		direction: ltr;
	}
</style>
