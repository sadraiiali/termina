<script lang="ts">
	import { marked } from 'marked'
	import type { ChapterMeta } from '$lib/course/catalog'

	interface Props {
		chapter: ChapterMeta
		markdown: string
		onRun?: (cmd: string) => void
	}

	let { chapter, markdown, onRun }: Props = $props()

	const html = $derived.by(() => {
		marked.setOptions({ gfm: true, breaks: false })
		// Drop remote images that break offline; keep text
		const cleaned = markdown.replace(/<p align="center">[\s\S]*?<\/p>/gi, '')
		return marked.parse(cleaned) as string
	})
</script>

<article class="lesson" dir="rtl" lang="fa">
	<header class="lesson-head">
		<span class="badge">فصل {chapter.order}</span>
		<h1>{chapter.titleFa}</h1>
		<p class="en">{chapter.titleEn}</p>
	</header>

	{#if chapter.practice.length}
		<section class="practice">
			<h2>تمرین در ترمینال</h2>
			<p class="hint">روی هر دستور کلیک کنید تا در ترمینال اجرا شود.</p>
			<div class="cmds">
				{#each chapter.practice as cmd (cmd)}
					<button type="button" class="cmd" onclick={() => onRun?.(cmd)}>
						<code>{cmd}</code>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<!-- key keeps DOM swap local to body; header/practice stay stable when possible -->
	{#key chapter.id}
		<div class="body prose">
			{@html html}
		</div>
	{/key}
</article>

<style>
	.lesson {
		padding: 1.25rem 1.5rem 3rem;
		max-width: 52rem;
		margin: 0 auto;
	}

	.lesson-head {
		margin-bottom: 1.25rem;
		border-bottom: 1px solid var(--border);
		padding-bottom: 1rem;
	}

	.badge {
		display: inline-block;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		margin-bottom: 0.5rem;
	}

	h1 {
		font-size: 1.65rem;
		font-weight: 700;
		margin: 0.25rem 0;
		line-height: 1.4;
	}

	.en {
		margin: 0;
		color: var(--muted);
		font-size: 0.95rem;
		direction: ltr;
		text-align: right;
	}

	.practice {
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1rem 1.1rem;
		margin-bottom: 1.5rem;
	}

	.practice h2 {
		margin: 0 0 0.35rem;
		font-size: 1.05rem;
	}

	.hint {
		margin: 0 0 0.75rem;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.cmds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		direction: ltr;
		justify-content: flex-end;
	}

	.cmd {
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text);
		border-radius: 8px;
		padding: 0.35rem 0.65rem;
		cursor: pointer;
		font-family: var(--mono);
		font-size: 0.85rem;
		transition: border-color 0.15s, background 0.15s;
	}

	.cmd:hover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.cmd code {
		font: inherit;
		color: var(--green);
	}

	.prose {
		line-height: 1.9;
		font-size: 1.02rem;
		color: var(--text);
	}

	.prose :global(h1),
	.prose :global(h2),
	.prose :global(h3) {
		line-height: 1.45;
		margin: 1.6rem 0 0.65rem;
		font-weight: 700;
	}

	.prose :global(h1) {
		font-size: 1.35rem;
	}
	.prose :global(h2) {
		font-size: 1.2rem;
	}
	.prose :global(h3) {
		font-size: 1.08rem;
	}

	.prose :global(p) {
		margin: 0.65rem 0;
	}

	.prose :global(ul),
	.prose :global(ol) {
		padding-right: 1.35rem;
		padding-left: 0;
		margin: 0.5rem 0;
	}

	.prose :global(li) {
		margin: 0.25rem 0;
	}

	.prose :global(pre) {
		direction: ltr;
		text-align: left;
		background: var(--code-bg);
		color: var(--code-fg);
		border-radius: 10px;
		padding: 0.85rem 1rem;
		overflow-x: auto;
		font-size: 0.88rem;
		border: 1px solid var(--border);
		margin: 0.85rem 0;
	}

	.prose :global(code) {
		font-family: var(--mono);
		font-size: 0.9em;
	}

	.prose :global(:not(pre) > code) {
		background: var(--panel-2);
		padding: 0.1rem 0.35rem;
		border-radius: 5px;
		border: 1px solid var(--border);
		direction: ltr;
		display: inline-block;
	}

	.prose :global(hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 1.5rem 0;
	}

	.prose :global(a) {
		color: var(--accent);
	}

	.prose :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: 8px;
	}

	.prose :global(blockquote) {
		margin: 0.85rem 0;
		padding: 0.4rem 1rem;
		border-right: 3px solid var(--accent);
		background: var(--panel-2);
		color: var(--muted);
	}
</style>
