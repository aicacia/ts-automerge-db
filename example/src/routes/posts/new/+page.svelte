<script lang="ts">
	import z from 'zod';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { createForm } from '$lib/error.svelte';
	import Errors from '$lib/components/Errors.svelte';

	const newPostForm = createForm(
		z.object({
			title: z.string().min(3),
			uri: z
				.string()
				.min(3)
				.regex(/[a-zA-Z0-9\-._~]+/),
			content: z.string().nonempty()
		}),
		{
			title: '',
			uri: '',
			content: ''
		}
	);

	let creating = $state(false);
	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		try {
			creating = true;

			const result = await newPostForm.validate();

			if (!result.success) {
				return;
			}

			const [_postId, post] = await db.collections.posts.create({
				...result.data,
				createdAt: Date.now()
			});
			await goto(resolve('/posts/[uri]', { uri: post.uri }));
		} finally {
			creating = false;
		}
	}
</script>

<div>
	<a href={resolve('/')}>Back</a>
</div>

<form class="flex flex-col" onsubmit={onSubmit}>
	<label class="flex flex-col">
		Title
		<input type="text" name="title" bind:value={newPostForm.title.value} />
		<Errors errors={newPostForm.title.errors} />
	</label>
	<label class="flex flex-col">
		URI
		<input type="text" name="uri" bind:value={newPostForm.uri.value} />
		<Errors errors={newPostForm.uri.errors} />
	</label>
	<label class="flex flex-col">
		Content
		<textarea bind:value={newPostForm.content.value}></textarea>
		<Errors errors={newPostForm.content.errors} />
	</label>
	<input type="submit" class="btn primary mt-4" value="Post" disabled={creating} />
</form>
