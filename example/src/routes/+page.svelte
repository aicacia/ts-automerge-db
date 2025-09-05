<script lang="ts">
import { onMount } from "svelte";
import type { RowResult } from "@aicacia/automerge-db";
import type { Post } from "$lib/posts";
import { db } from "$lib/db";
import { resolve } from "$app/paths";

let posts: RowResult<Post>[] = [];

onMount(async () => {
	const [newPosts, err] = await db.collections.posts.find({
		sort(a, b) {
			return a.createdAt - b.createdAt;
		},
	});
	if (err) {
		console.error(err);
		return;
	}
	posts = newPosts;
});
</script>

<div class="flex flex-row items-center justify-between">
	<h1>Posts</h1>
	<a class="btn primary" href={resolve('/posts/new')}>New Posts</a>
</div>

<div>
	{#each posts as [id, post] (id)}
		<li>
			<a href={resolve('/posts/[uri]', { uri: post.uri })}>{post.title}</a>
		</li>
	{/each}
</div>
