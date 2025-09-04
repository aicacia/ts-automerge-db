<script lang="ts">
import type { PageProps } from "./$types";
import { db } from "$lib/db";
import { resolve } from "$app/paths";

let { params }: PageProps = $props();

let postPromise = $derived.by(async () => {
	const [posts, err] = await db.collections.posts.findByIndex(
		"uri",
		params.uri,
	);
	if (err) {
		throw err;
	}
	if (posts.length === 0) {
		throw new Error("No Posts found");
	}
	return posts[0][1];
});
</script>

<div>
	<a href={resolve('/')}>Back</a>
</div>

<article class="flex flex-col">
	{#await postPromise}
		<div class="flex grow items-center justify-center">
			<span>loading...</span>
		</div>
	{:then post}
		<h1>{post.title}</h1>
		<p>{post.content}</p>
	{/await}
</article>
