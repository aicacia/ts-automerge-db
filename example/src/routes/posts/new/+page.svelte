<script lang="ts" module>
	import z from 'zod';

	const NewPostSchema = z.object({
		title: z.string().min(3),
		uri: z
			.string()
			.min(3)
			.regex(/[a-zA-Z0-9\-\._~]+/),
		content: z.string().nonempty()
	});

	type NewPost = z.infer<typeof NewPostSchema>;
</script>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db';
	import { zodErrorToObject } from '$lib/error';
	import Errors from '$lib/components/Errors.svelte';

	const newPost = $state<NewPost>({
		title: '',
		uri: '',
		content: ''
	});
	let newPostResult = $state<z.ZodSafeParseResult<NewPost>>();
	let newPostErrors = $derived(zodErrorToObject(newPostResult?.error));

	let creating = $state(false);
	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		try {
			creating = true;

			const result = (newPostResult = await NewPostSchema.safeParseAsync(newPost));

			if (result.error) {
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
		<input type="text" name="title" bind:value={newPost.title} />
		<Errors errors={newPostErrors.title} />
	</label>
	<label class="flex flex-col">
		URI
		<input type="text" name="uri" bind:value={newPost.uri} />
		<Errors errors={newPostErrors.uri} />
	</label>
	<label class="flex flex-col">
		Content
		<textarea bind:value={newPost.content}></textarea>
		<Errors errors={newPostErrors.content} />
	</label>
	<input type="submit" class="btn primary mt-4" value="Post" disabled={creating} />
</form>
