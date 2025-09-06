<script lang="ts" module>
	import type z from 'zod';

	export interface ErrorsProps {
		errors?: z.core.$ZodIssue[];
	}
</script>

<script lang="ts">
	let { errors = [] }: ErrorsProps = $props();
</script>

<ul class="list-none p-0">
	{#each errors as error}
		<li class="text-red-500">{error.message}</li>
	{/each}
</ul>
