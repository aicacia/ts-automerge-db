<script lang="ts">
import type { PageProps } from "./$types";
import { db } from "$lib/db";
import { resolve } from "$app/paths";
import { goto } from "$app/navigation";

let { data }: PageProps = $props();

let deleting = $state(false);
async function onDelete() {
	try {
		deleting = true;
		await db.collections.posts.delete(data.postId);
		await goto(resolve("/"));
	} finally {
		deleting = false;
	}
}
</script>

<div>
	<a href={resolve('/')}>Back</a>
</div>

<article class="flex flex-col">
	<div class="flex flex-row justify-between">
		<h1>{data.post.title}</h1>
		<div class="flex flex-col">
			<a class="btn primary" href={resolve('/posts/[uri]/edit', { uri: data.post.uri })}>Edit</a>
			<button class="btn danger" onclick={onDelete} disabled={deleting}>Delete</button>
		</div>
	</div>
	<p>{data.post.content}</p>
</article>
