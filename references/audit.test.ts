// bun test references/
// The header sets below are copied from real responses (21 Nov 2026).

import { describe, expect, test } from "bun:test";
import { blockedFromSite, looksLikeHtml, markdownAlternate, parseLlmsTxt, parseRobots, twinGuess, visibleText } from "./audit";
import { classifyCache } from "./cache-status";

describe("classifyCache", () => {
	test("Netlify: the durable cache answered", () => {
		const verdict = classifyCache({
			"cache-status": '"Netlify Durable"; hit; ttl=31534934, "Next.js"; hit, "Netlify Edge"; fwd=miss; fwd-status=200; stored',
			"cache-control": "s-maxage=31536000",
		});
		expect(verdict.served).toBe("cache");
	});

	test("Netlify: the edge node answered, whatever the stored entries say", () => {
		const verdict = classifyCache({
			"cache-status": '"Next.js"; hit, "Netlify Durable"; fwd=uri-miss; stored, "Netlify Edge"; hit; ttl=2591831',
		});
		expect(verdict.served).toBe("cache");
	});

	test("Netlify: a function ran, for each reason the durable cache gives", () => {
		for (const reason of ["bypass", "stale; ttl=-2593090; stored", "uri-miss; stored", "vary-miss"]) {
			const verdict = classifyCache({
				"cache-status": `"Next.js"; hit, "Netlify Durable"; fwd=${reason}, "Netlify Edge"; fwd=miss; fwd-status=200; stored`,
			});
			expect(verdict.served).toBe("origin");
			expect(verdict.detail).toContain("Netlify Durable");
		}
	});

	test("Netlify: a deployed file read from the file store is not a function", () => {
		const verdict = classifyCache({
			"cache-status": '"Netlify Edge"; fwd=miss; fwd-status=200; stored',
			"cache-control": "public,max-age=0,must-revalidate",
		});
		expect(verdict.served).toBe("cache");
		const chunk = classifyCache({
			"cache-status": '"Netlify Edge"; fwd=miss; fwd-status=200; stored',
			"cache-control": "public,max-age=31536000,immutable",
			etag: '"31600bf28f940b3fe6506311622773ae-ssl"',
		});
		expect(chunk.served).toBe("cache");
	});

	test("Netlify: an edge miss with other cache rules is left unknown", () => {
		const verdict = classifyCache({ "cache-status": '"Netlify Edge"; fwd=miss', "cache-control": "no-cache" });
		expect(verdict.served).toBe("unknown");
	});

	test("a header sent three times, joined with newlines as Chrome does", () => {
		const verdict = classifyCache({
			"cache-status": '"Next.js"; hit\n"Netlify Durable"; fwd=bypass\n"Netlify Edge"; fwd=miss',
		});
		expect(verdict.served).toBe("origin");
	});

	test("Vercel", () => {
		expect(classifyCache({ "x-vercel-cache": "HIT" }).served).toBe("cache");
		expect(classifyCache({ "x-vercel-cache": "PRERENDER" }).served).toBe("cache");
		expect(classifyCache({ "x-vercel-cache": "STALE" }).served).toBe("cache");
		expect(classifyCache({ "x-vercel-cache": "MISS" }).served).toBe("origin");
		expect(classifyCache({ "x-vercel-cache": "BYPASS" }).served).toBe("origin");
	});

	test("Cloudflare", () => {
		expect(classifyCache({ "cf-cache-status": "HIT" }).served).toBe("cache");
		expect(classifyCache({ "cf-cache-status": "DYNAMIC" }).served).toBe("origin");
		expect(classifyCache({ "cf-cache-status": "MISS" }).served).toBe("origin");
	});

	test("X-Cache, Age and Cache-Control as fallbacks", () => {
		expect(classifyCache({ "x-cache": "Hit from cloudfront" }).served).toBe("cache");
		expect(classifyCache({ "x-cache": "Miss from cloudfront" }).served).toBe("origin");
		expect(classifyCache({ age: "120" }).served).toBe("cache");
		expect(classifyCache({ "cache-control": "private, no-store" }).served).toBe("origin");
		expect(classifyCache({}).served).toBe("unknown");
	});
});

describe("robots.txt", () => {
	test("an open file blocks nobody", () => {
		const robots = parseRobots("User-agent: *\nAllow: /\nAllow: /api/agent/\nDisallow: /api/\n\nSitemap: https://example.com/sitemap.xml\n");
		expect(blockedFromSite(robots)).toEqual([]);
		expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
	});

	test("Disallow: / for everyone", () => {
		expect(blockedFromSite(parseRobots("User-agent: *\nDisallow: /\n"))).toEqual(["*"]);
	});

	test("named agents that share one group are all blocked", () => {
		const robots = parseRobots("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n");
		expect(blockedFromSite(robots)).toEqual(["GPTBot", "ClaudeBot"]);
	});

	test("an empty Disallow allows everything", () => {
		expect(blockedFromSite(parseRobots("User-agent: *\nDisallow:\n"))).toEqual([]);
	});

	test("comments and an Allow: / beside the Disallow", () => {
		expect(blockedFromSite(parseRobots("# hello\nUser-agent: * # all\nDisallow: /\nAllow: /\n"))).toEqual([]);
	});
});

describe("llms.txt", () => {
	const text = "# Motion Garden\n\n> Animated React components.\n\n## Backgrounds\n\n- [Waves](https://example.com/components/waves): calm lines (9 props)\n- [Grainient](/components/grainient)\n\n## Optional\n\n- [Cook Book](https://example.com/cookbook)\n";

	test("title, summary, sections and links", () => {
		const parsed = parseLlmsTxt(text);
		expect(parsed.title).toBe("Motion Garden");
		expect(parsed.summary).toBe("Animated React components.");
		expect(parsed.sections).toEqual(["Backgrounds", "Optional"]);
		expect(parsed.links.map((link) => link.url)).toEqual(["https://example.com/components/waves", "/components/grainient", "https://example.com/cookbook"]);
	});

	test("an app shell served at /llms.txt is seen as HTML", () => {
		expect(looksLikeHtml("<!DOCTYPE html><html><body><div id=root></div></body></html>", "text/plain")).toBe(true);
		expect(looksLikeHtml(text, "text/plain; charset=utf-8")).toBe(false);
		expect(looksLikeHtml("{}", "text/html; charset=utf-8")).toBe(true);
	});
});

describe("page reading", () => {
	test("visibleText drops scripts, styles and tags", () => {
		const html = '<html><head><title>T</title><style>p{color:red}</style></head><body><script>var a = "<p>no</p>";</script><h1>Waves</h1><p>Calm &amp; slow.</p><!-- note --></body></html>';
		expect(visibleText(html)).toBe("Waves Calm & slow.");
	});

	test("a page that is only a script mount has no text", () => {
		expect(visibleText('<html><body><div id="root"></div><script src="/app.js"></script></body></html>')).toBe("");
	});

	test("the Markdown twin a page names", () => {
		const page = "https://example.com/components/waves";
		expect(markdownAlternate('<link rel="alternate" type="text/markdown" href="https://example.com/components/waves.md"/>', page)).toBe("https://example.com/components/waves.md");
		expect(markdownAlternate("<link href='/index.md' type='text/markdown' rel='alternate'>", page)).toBe("https://example.com/index.md");
		expect(markdownAlternate('<link rel="alternate" type="application/rss+xml" href="/feed.xml">', page)).toBeNull();
		expect(markdownAlternate('<link rel="stylesheet" href="/a.css">', page)).toBeNull();
	});

	test("the twin's address by convention", () => {
		expect(twinGuess("https://example.com/components/waves?speed=2")).toBe("https://example.com/components/waves.md");
		expect(twinGuess("https://example.com/")).toBe("https://example.com/index.html.md");
		expect(twinGuess("https://example.com/docs/")).toBe("https://example.com/docs/index.html.md");
	});
});
