<script lang="ts">
	import z from 'zod';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import type { PageProps } from './$types';
	import Errors from '$lib/components/Errors.svelte';
	import { createForm } from '$lib/error.svelte';

	let { data }: PageProps = $props();

	const editPostForm = createForm(
		z.object({
			title: z.string().min(3),
			uri: z.string().regex(/[a-zA-Z0-9\-._~]+/),
			content: z.string().nonempty()
		}),
		{
			title: data.post.title,
			uri: data.post.title,
			content: data.post.content
		}
	);

	let updating = $state(false);

	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		try {
			updating = true;

			const result = await editPostForm.validate();

			if (!result.success) {
				return;
			}

			const [_postId, post] = await db.collections.posts.update(data.postId, (post) => {
				if (post.title !== result.data.title) {
					post.title = result.data.title;
				}
				if (post.uri !== result.data.uri) {
					post.uri = result.data.uri;
				}
				if (post.content !== result.data.content) {
					post.content = result.data.content;
				}
			});
			await goto(resolve('/posts/[uri]', { uri: post.uri }));
		} finally {
			updating = false;
		}
	}
</script>

<div>
	<a href={resolve('/posts/[uri]', { uri: data.post.uri })}>Back</a>
</div>

<form class="flex flex-col" onsubmit={onSubmit}>
	<label class="flex flex-col">
		Title
		<input type="text" name="title" bind:value={editPostForm.title.value} />
		<Errors errors={editPostForm.title.errors} />
	</label>
	<label class="flex flex-col">
		URI
		<input type="text" name="uri" bind:value={editPostForm.uri.value} />
		<Errors errors={editPostForm.uri.errors} />
	</label>
	<label class="flex flex-col">
		Content
		<textarea bind:value={editPostForm.content.value}></textarea>
		<Errors errors={editPostForm.content.errors} />
	</label>
	<input type="submit" class="btn primary mt-4" value="Update" disabled={updating} />
</form>
