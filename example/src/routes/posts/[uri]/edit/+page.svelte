<script lang="ts" module>
	import z from 'zod';

	const EditPostSchema = z.object({
		title: z.string().min(3),
		uri: z.string().regex(/[a-zA-Z0-9\-\._~]+/),
		content: z.string().nonempty()
	});

	type EditPost = z.infer<typeof EditPostSchema>;
</script>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import type { PageProps } from './$types';
	import Errors from '$lib/components/Errors.svelte';
	import { zodErrorToObject } from '$lib/error';

	let { data }: PageProps = $props();

	const editPost: EditPost = $state(data.post);
	let editPostResult = $state<z.ZodSafeParseResult<EditPost>>();
	let editPostErrors = $derived(zodErrorToObject(editPostResult?.error));

	let updating = $state(false);

	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		try {
			updating = true;

			const result = (editPostResult = await EditPostSchema.safeParseAsync(editPost));

			if (result.error) {
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
		<input type="text" name="title" bind:value={editPost.title} />
		<Errors errors={editPostErrors.title} />
	</label>
	<label class="flex flex-col">
		URI
		<input type="text" name="uri" bind:value={editPost.uri} />
		<Errors errors={editPostErrors.uri} />
	</label>
	<label class="flex flex-col">
		Content
		<textarea bind:value={editPost.content}></textarea>
		<Errors errors={editPostErrors.content} />
	</label>
	<input type="submit" class="btn primary mt-4" value="Update" disabled={updating} />
</form>
