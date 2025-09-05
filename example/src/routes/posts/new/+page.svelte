<script lang="ts">
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { db } from "$lib/db";

let title = $state("");
let uri = $state("");
let content = $state("");

let creating = $state(false);
async function onSubmit(e: SubmitEvent) {
	e.preventDefault();

	if (title && uri && content) {
		try {
			creating = true;
			await db.collections.posts.create({
				title,
				uri,
				content,
				createdAt: Date.now(),
			});
			await goto(resolve("/posts/[uri]", { uri }));
		} finally {
			creating = false;
		}
	}
}
</script>

<div>
	<a href={resolve('/')}>Back</a>
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
	<input type="submit" class="btn primary mt-4" value="Post" disabled={creating} />
</form>
