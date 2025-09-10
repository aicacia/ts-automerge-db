import { db } from '$lib/db';
import type { LayoutLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async (event) => {
	const [posts, err] = await db.collections.posts.findByIndex('uri', event.params.uri);
	if (err) {
		throw err;
	}
	if (posts.length === 0) {
		throw new Error('No Posts found');
	}
	const [postId, post] = posts[0];
	return {
		postId,
		post
	};
};
