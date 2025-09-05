<script lang="ts">
import { goto, invalidateAll } from "$app/navigation";
import { resolve } from "$app/paths";
import { db } from "$lib/db";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();

let title = $state(data.post.title);
let uri = $state(data.post.uri);
let content = $state(data.post.content);

let updating = $state(false);
async function onSubmit(e: SubmitEvent) {
	e.preventDefault();

	if (title && uri && content) {
		try {
			updating = true;
			await db.collections.posts.update(data.postId, (post) => {
				if (post.title !== title) {
					post.title = title;
				}
				if (post.content !== content) {
					post.content = content;
				}
				if (post.uri !== uri) {
					post.uri = uri;
				}
			});
			await invalidateAll();
			await goto(resolve("/posts/[uri]", { uri }));
		} finally {
			updating = false;
		}
	}
}
</script>

<div>
	<a href={resolve('/posts/[uri]', { uri: data.post.uri })}>Back</a>
</div>

<form class="flex flex-col" onsubmit={onSubmit}>
	<label class="flex flex-col">
		Title
		<input type="text" name="title" bind:value={title} />
	</label>
	<label class="flex flex-col">
		URI
		<input type="text" name="uri" bind:value={uri} />
	</label>
	<label class="flex flex-col">
		Content
		<textarea bind:value={content}></textarea>
	</label>
	<input type="submit" class="btn primary mt-4" value="Update" disabled={updating} />
</form>
