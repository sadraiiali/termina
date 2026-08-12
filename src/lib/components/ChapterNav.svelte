<script lang="ts">
	import type { ChapterMeta } from '$lib/course/catalog'
	import Icon from '$lib/components/Icon.svelte'

	interface Props {
		chapters: ChapterMeta[]
		activeId: string
		onSelect: (id: string) => void
	}

	let { chapters, activeId, onSelect }: Props = $props()
</script>

<nav class="nav" dir="rtl" aria-label="فهرست فصول">
	<div class="brand">
		<span class="logo" aria-hidden="true">
			<Icon name="command-line" size="1.25rem" />
		</span>
		<div>
			<strong>آموزش ترمینال لینوکس</strong>
		</div>
	</div>
	<ul>
		{#each chapters as ch (ch.id)}
			<li>
				<button
					type="button"
					class:active={ch.id === activeId}
					onclick={() => onSelect(ch.id)}
				>
					<span class="num">{String(ch.order).padStart(2, '0')}</span>
					<span class="title">{ch.titleFa}</span>
				</button>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.nav {
		display: flex;
		flex-direction: column;
		height: 100%;
		max-height: 100%;
		min-height: 0;
		overflow: hidden;
		background: var(--panel);
		border-left: 1px solid var(--border);
	}

	.brand {
		display: flex;
		gap: 0.65rem;
		align-items: center;
		height: var(--chrome-height);
		min-height: var(--chrome-height);
		max-height: var(--chrome-height);
		padding: 0 1rem;
		box-sizing: border-box;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	.logo {
		color: var(--accent);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.brand strong {
		display: block;
		font-size: 0.9rem;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0.5rem;
		overflow-x: hidden;
		overflow-y: auto;
		flex: 1 1 0;
		min-height: 0;
		overscroll-behavior: contain;
	}

	button {
		width: 100%;
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
		text-align: right;
		border: none;
		background: transparent;
		color: var(--text);
		padding: 0.55rem 0.65rem;
		border-radius: 8px;
		cursor: pointer;
		font: inherit;
		font-size: 0.9rem;
		line-height: 1.4;
		transition: background 0.12s;
	}

	button:hover {
		background: var(--panel-2);
	}

	button.active {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}

	.num {
		font-family: var(--mono);
		font-size: 0.78rem;
		opacity: 0.7;
		min-width: 1.5rem;
		direction: ltr;
	}

	.title {
		flex: 1;
	}
</style>
