<script lang="ts">
	import { theme } from '$lib/theme.svelte'
	import Icon from '$lib/components/Icon.svelte'

	function toggle(): void {
		theme.toggle()
	}

	const label = $derived(theme.current === 'dark' ? 'تم روشن' : 'تم تیره')
	const iconName = $derived(theme.current === 'dark' ? 'sun' : 'moon')
</script>

<button
	type="button"
	class="theme-toggle"
	onclick={toggle}
	title={label}
	aria-label={label}
>
	<Icon name={iconName} size="1.15rem" />
</button>

<style>
	.theme-toggle {
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: var(--control-height, 2rem);
		min-height: var(--control-height, 2rem);
		width: var(--control-height, 2rem);
		min-width: var(--control-height, 2rem);
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		font: inherit;
		flex-shrink: 0;
	}

	.theme-toggle:hover {
		background: var(--panel-2);
	}
</style>
