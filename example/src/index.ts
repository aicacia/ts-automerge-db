import { db } from "./db";

async function main() {
	db.documents.settings.subscribe((settings) => {
		document.body.classList.add(settings.theme);
		document.documentElement.setAttribute("lang", settings.locale);
	});

	const [comments, commentsErr] = await db.collections.comments.find();
	if (commentsErr) {
		throw commentsErr;
	}
	console.log(comments);

	const [posts, postsErr] = await db.collections.posts.findByIndex(
		"uri",
		"test",
	);
	if (postsErr) {
		throw postsErr;
	}
	console.log(posts);
}

if (document.readyState !== "loading") {
	main();
} else {
	document.addEventListener("DOMContentLoaded", main);
}
