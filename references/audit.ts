#!/usr/bin/env bun
// Scores a live website for AI agents, with plain HTTP requests and no browser.
//
//   bun audit.ts https://example.com
//   bun audit.ts https://example.com --page /docs/install
//   bun audit.ts https://example.com --json
//
// It asks four questions, one per rung of the ladder in SKILL.md:
//   Findable  can an agent find out what the site has?   (robots.txt, llms.txt, sitemap)
//   Readable  can it read a page as text?                (text without scripts, a Markdown twin)
//   Operable  does the site publish tools?               (an agent manifest; other conventions)
//   Cost      does an agent's read run your server?      (cache headers on a second request)
//
// It sends about 20 to 30 GET requests to the site you name and to nothing
// else. Its user agent is "agentify-audit/1.0".
//
// What it cannot see: anything that needs a script to run, what a real page
// view costs (use page-cost.ts), and whether the documents are true.

import { classifyCache, describeVerdict, type CacheVerdict } from "./cache-status";

const USER_AGENT = "agentify-audit/1.0";
const TIMEOUT_MS = 15_000;
const BODY_LIMIT = 2_000_000;

/** AI agents and crawlers a robots.txt may name. Reported, never judged. */
export const AI_AGENTS = [
	"GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot",
	"PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot",
	"Bytespider", "Amazonbot", "meta-externalagent",
];

// ---------------------------------------------------------------- pure helpers

export interface RobotsGroup {
	agents: string[];
	rules: { allow: boolean; path: string }[];
}

export interface Robots {
	groups: RobotsGroup[];
	sitemaps: string[];
}

export function parseRobots(text: string): Robots {
	const groups: RobotsGroup[] = [];
	const sitemaps: string[] = [];
	let current: RobotsGroup | null = null;
	let lastWasAgent = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, "").trim();
		const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
		if (!match) continue;
		const field = match[1].toLowerCase();
		const value = match[2].trim();
		if (field === "user-agent") {
			if (!current || !lastWasAgent) {
				current = { agents: [], rules: [] };
				groups.push(current);
			}
			current.agents.push(value);
			lastWasAgent = true;
			continue;
		}
		lastWasAgent = false;
		if (field === "sitemap") sitemaps.push(value);
		else if ((field === "allow" || field === "disallow") && current) {
			// An empty Disallow allows everything, so it is no rule at all.
			if (value) current.rules.push({ allow: field === "allow", path: value });
		}
	}
	return { groups, sitemaps };
}

/**
 * The agents a robots.txt shuts out of the whole site: a group with
 * `Disallow: /` and no `Allow: /` beside it (an equal match goes to Allow).
 * "*" in the answer means every agent with no group of its own.
 */
export function blockedFromSite(robots: Robots): string[] {
	const blocked: string[] = [];
	for (const group of robots.groups) {
		const disallowAll = group.rules.some((rule) => !rule.allow && (rule.path === "/" || rule.path === "/*"));
		const allowAll = group.rules.some((rule) => rule.allow && (rule.path === "/" || rule.path === "/*"));
		if (disallowAll && !allowAll) blocked.push(...group.agents);
	}
	return [...new Set(blocked)];
}

export interface LlmsTxt {
	title: string | null;
	summary: string | null;
	sections: string[];
	links: { text: string; url: string }[];
}

/** Read an llms.txt (https://llmstxt.org): an H1, a quoted summary, H2 sections of links. */
export function parseLlmsTxt(text: string): LlmsTxt {
	const lines = text.split(/\r?\n/);
	const first = lines.find((line) => line.trim() !== "") ?? "";
	const title = /^#\s+(.+)$/.exec(first.trim())?.[1] ?? null;
	const summary = /^>\s*(.+)$/.exec(lines.find((line) => line.trim().startsWith(">"))?.trim() ?? "")?.[1] ?? null;
	const sections = lines.map((line) => /^##\s+(.+)$/.exec(line.trim())?.[1]).filter((name): name is string => Boolean(name));
	const links: LlmsTxt["links"] = [];
	for (const match of text.matchAll(/\[([^\]\n]+)\]\((\S+?)\)/g)) links.push({ text: match[1], url: match[2] });
	return { title, summary, sections, links };
}

export function looksLikeHtml(body: string, contentType: string): boolean {
	return /text\/html|application\/xhtml/i.test(contentType) || /^\s*(<!doctype html|<html[\s>])/i.test(body);
}

/** The text a reader gets from a page when no script runs. */
export function visibleText(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|template|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#x27;|&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

/** The page's Markdown twin, if it names one in `<link rel="alternate" type="text/markdown">`. */
export function markdownAlternate(html: string, pageUrl: string): string | null {
	for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
		const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
		const pick = (name: string) => {
			const found = attr(name);
			return found ? (found[2] ?? found[3] ?? found[4] ?? "") : "";
		};
		if (!/\balternate\b/i.test(pick("rel")) || !/^text\/markdown/i.test(pick("type"))) continue;
		const href = pick("href").replace(/&amp;/g, "&");
		if (!href) continue;
		try {
			return new URL(href, pageUrl).href;
		} catch {
			return null;
		}
	}
	return null;
}

/** `<page>.md`, the address the llms.txt convention gives a page's Markdown twin. */
export function twinGuess(pageUrl: string): string {
	const url = new URL(pageUrl);
	url.search = "";
	url.hash = "";
	url.pathname = url.pathname.endsWith("/") ? `${url.pathname}index.html.md` : `${url.pathname}.md`;
	return url.href;
}

// --------------------------------------------------------------------- network

interface Got {
	url: string;
	finalUrl: string;
	status: number;
	headers: Record<string, string>;
	body: string;
	error: string | null;
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Got> {
	try {
		const response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...headers },
			redirect: "follow",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const body = (await response.text()).slice(0, BODY_LIMIT);
		return {
			url,
			finalUrl: response.url || url,
			status: response.status,
			headers: Object.fromEntries([...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value])),
			body,
			error: null,
		};
	} catch (error) {
		return { url, finalUrl: url, status: 0, headers: {}, body: "", error: error instanceof Error ? error.message : String(error) };
	}
}

// ---------------------------------------------------------------------- report

type Rung = "Findable" | "Readable" | "Operable" | "Cost";
type Status = "pass" | "fail" | "warn" | "info";

interface Check {
	rung: Rung;
	status: Status;
	title: string;
	detail: string;
}

const MARK: Record<Status, string> = { pass: "ok  ", fail: "FAIL", warn: "warn", info: "info" };

function usage(): never {
	console.log(
		[
			"Usage: bun audit.ts <site url> [--page <path>] [--no-404] [--json]",
			"",
			"  --page <path>  the page to read as a sample (default: the first page llms.txt links, or the URL you gave)",
			"  --no-404       skip the missing-file request (it can run one function on your host)",
			"  --json         print the checks as JSON",
		].join("\n"),
	);
	process.exit(1);
}

async function main() {
	const args = process.argv.slice(2);
	const target = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--page");
	if (!target || args.includes("--help")) usage();
	let start: URL;
	try {
		start = new URL(/^https?:\/\//.test(target) ? target : `https://${target}`);
	} catch {
		usage();
	}
	const origin = start.origin;
	const pageFlag = args.includes("--page") ? args[args.indexOf("--page") + 1] : null;
	const sameOrigin = (url: string) => {
		try {
			return new URL(url, origin).origin === origin;
		} catch {
			return false;
		}
	};
	const short = (url: string) => (url.startsWith(origin) ? url.slice(origin.length) || "/" : url);

	const checks: Check[] = [];
	const add = (rung: Rung, status: Status, title: string, detail = "") => checks.push({ rung, status, title, detail });
	/** Documents an agent would read. Each is asked for a second time for the Cost rung. */
	const agentDocs = new Map<string, string>();

	// ------------------------------------------------------------- Findable
	const robotsGot = await get(`${origin}/robots.txt`);
	const robotsOk = robotsGot.status === 200 && !looksLikeHtml(robotsGot.body, robotsGot.headers["content-type"] ?? "");
	const robots = robotsOk ? parseRobots(robotsGot.body) : { groups: [], sitemaps: [] };
	if (!robotsOk) {
		add("Findable", "warn", "robots.txt", robotsGot.error ?? `answered ${robotsGot.status}${robotsGot.status === 200 ? " with an HTML page" : ""}. Without one, every agent may read everything, which may be what you want. Say so in a file.`);
	} else {
		const blocked = blockedFromSite(robots);
		const everyone = blocked.includes("*");
		const named = blocked.filter((agent) => AI_AGENTS.some((known) => known.toLowerCase() === agent.toLowerCase()));
		if (everyone) add("Findable", "fail", "robots.txt shuts every agent out", "`User-agent: *` has `Disallow: /`. An agent that obeys it reads nothing.");
		else if (named.length > 0) add("Findable", "warn", "robots.txt blocks some AI agents", `${named.join(", ")}. That is the owner's call. A blocked agent cannot read the site.`);
		else add("Findable", "pass", "robots.txt lets agents in", `${robots.groups.length} group${robots.groups.length === 1 ? "" : "s"}, no AI agent shut out of the whole site`);
	}

	const llmsGot = await get(`${origin}/llms.txt`);
	const llmsIsHtml = looksLikeHtml(llmsGot.body, llmsGot.headers["content-type"] ?? "");
	let llms: LlmsTxt | null = null;
	if (llmsGot.status !== 200) {
		add("Findable", "fail", "/llms.txt", llmsGot.error ?? `answered ${llmsGot.status}. It is the index an agent reads first (llmstxt.org).`);
	} else if (llmsIsHtml) {
		add("Findable", "fail", "/llms.txt is an HTML page", "The site answers 200 with a web page, most likely its app shell. An agent will read that as the index.");
	} else {
		llms = parseLlmsTxt(llmsGot.body);
		agentDocs.set(`${origin}/llms.txt`, "/llms.txt");
		const size = llmsGot.body.length.toLocaleString("en-US");
		if (!llms.title) add("Findable", "warn", "/llms.txt has no title", "The first line should be `# Site name`.");
		else if (llms.links.length === 0) add("Findable", "warn", "/llms.txt has no links", `"${llms.title}", ${size} characters, but nothing to follow.`);
		else add("Findable", "pass", "/llms.txt", `"${llms.title}", ${llms.links.length} links in ${llms.sections.length} sections, ${size} characters`);
		if (llmsGot.body.length > 100_000) {
			add("Findable", "warn", "/llms.txt is long", `${size} characters. Many agents cut a long fetch short. Keep it an index: one line per page, with the content in each page's own document.`);
		}
		const own = [...new Set(llms.links.map((link) => link.url).filter(sameOrigin).map((url) => new URL(url, origin).href))];
		const sample = own.filter((_, index) => index % Math.max(1, Math.floor(own.length / 5)) === 0).slice(0, 5);
		const broken: string[] = [];
		for (const url of sample) {
			const got = await get(url);
			if (got.status !== 200) broken.push(`${short(url)} (${got.status || got.error})`);
		}
		if (sample.length > 0) {
			if (broken.length > 0) add("Findable", "fail", "/llms.txt links to pages that do not answer", broken.join(", "));
			else add("Findable", "pass", "/llms.txt links answer", `${sample.length} of ${own.length} checked`);
		}
	}

	const sitemapUrl = robots.sitemaps[0] ?? `${origin}/sitemap.xml`;
	const sitemapGot = await get(sitemapUrl);
	if (sitemapGot.status === 200 && /<(urlset|sitemapindex)\b/i.test(sitemapGot.body)) {
		const count = (sitemapGot.body.match(/<loc>/gi) ?? []).length;
		add("Findable", "pass", "sitemap", `${short(sitemapUrl)}, ${count} address${count === 1 ? "" : "es"}`);
	} else {
		add("Findable", "warn", "no sitemap", `${short(sitemapUrl)} answered ${sitemapGot.status || sitemapGot.error}`);
	}

	// ------------------------------------------------------------- Readable
	let pageUrl = pageFlag ? new URL(pageFlag, origin).href : start.pathname !== "/" ? start.href : null;
	if (!pageUrl && llms) {
		const candidate = llms.links.map((link) => link.url).find((url) => sameOrigin(url) && !/\.(md|txt|json|xml)(\?|$)/i.test(url) && new URL(url, origin).pathname !== "/");
		if (candidate) pageUrl = new URL(candidate, origin).href;
	}
	pageUrl ??= `${origin}/`;
	const pageGot = await get(pageUrl, { Accept: "text/html" });
	const pageIsHtml = pageGot.status === 200 && looksLikeHtml(pageGot.body, pageGot.headers["content-type"] ?? "");
	if (!pageIsHtml) {
		add("Readable", "fail", `sample page ${short(pageUrl)}`, pageGot.error ?? `answered ${pageGot.status}, not an HTML page`);
	} else {
		const text = visibleText(pageGot.body);
		const chars = text.length.toLocaleString("en-US");
		const scripted = /<script/i.test(pageGot.body);
		if (text.length < 500 && scripted) add("Readable", "fail", `${short(pageUrl)} is empty until scripts run`, `${chars} characters of text in the HTML. Most agents fetch the page and run no script.`);
		else if (text.length < 500) add("Readable", "info", `${short(pageUrl)} is a short page`, `${chars} characters of text, and no scripts`);
		else add("Readable", "pass", `${short(pageUrl)} has text without scripts`, `${chars} characters`);

		const named = markdownAlternate(pageGot.body, pageGot.finalUrl);
		const tries: { url: string; how: string; headers?: Record<string, string> }[] = [];
		if (named) tries.push({ url: named, how: 'named in <link rel="alternate" type="text/markdown">' });
		tries.push({ url: twinGuess(pageGot.finalUrl), how: "found by adding .md to the address" });
		tries.push({ url: pageGot.finalUrl, how: "given for the header Accept: text/markdown", headers: { Accept: "text/markdown" } });
		let twin: { got: Got; how: string } | null = null;
		for (const attempt of tries) {
			const got = await get(attempt.url, attempt.headers);
			if (got.status === 200 && got.body.trim() !== "" && !looksLikeHtml(got.body, got.headers["content-type"] ?? "")) {
				twin = { got, how: attempt.how };
				break;
			}
		}
		if (!twin) {
			add("Readable", "fail", "no Markdown twin", `${short(pageUrl)} names none, ${short(twinGuess(pageGot.finalUrl))} does not answer with text, and asking for text/markdown returns the web page.`);
		} else {
			const type = twin.got.headers["content-type"] ?? "no content type";
			add("Readable", "pass", "Markdown twin", `${short(twin.got.url)}, ${twin.got.body.length.toLocaleString("en-US")} characters, ${type}, ${twin.how}`);
			if (!twin.got.headers.vary?.toLowerCase().includes("accept") && twin.got.url === pageGot.finalUrl) {
				add("Readable", "warn", "the twin shares the page's address without Vary: Accept", "A cache can hand the Markdown to a browser, or the page to an agent.");
			}
			if (!named && twin.got.url !== pageGot.finalUrl) add("Readable", "warn", "the page does not name its twin", 'Add <link rel="alternate" type="text/markdown" href="..."> so an agent on the page can find it.');
			if (twin.got.url !== pageGot.finalUrl) agentDocs.set(twin.got.url, short(twin.got.url));
			const cors = twin.got.headers["access-control-allow-origin"];
			if (cors === "*") add("Readable", "pass", "the twin allows any origin", "Access-Control-Allow-Origin: *");
			else add("Readable", "warn", "the twin has no open CORS header", "An agent that runs in a browser on another site cannot read it. Public documents can send Access-Control-Allow-Origin: *.");
		}
		const jsonLd = (pageGot.body.match(/<script[^>]+application\/ld\+json/gi) ?? []).length;
		add("Readable", "info", "structured data", jsonLd > 0 ? `${jsonLd} JSON-LD block${jsonLd === 1 ? "" : "s"} on the page` : "no JSON-LD on the page");
	}

	// Data documents the index points to (JSON, Markdown, text). Up to three, for the Cost rung.
	if (llms) {
		const data = [...new Set(llms.links.map((link) => link.url).filter(sameOrigin).map((url) => new URL(url, origin).href))]
			.filter((url) => /\.(md|json|txt)$/i.test(new URL(url).pathname) && !agentDocs.has(url))
			.slice(0, 3);
		for (const url of data) agentDocs.set(url, short(url));
	}

	// ------------------------------------------------------------- Operable
	const manifestPaths = ["/agent-manifest.json", "/agent/agent-manifest.json"];
	const fromIndex = llmsGot.body.match(/https?:\/\/[^\s)]+agent-manifest\.json/)?.[0];
	if (fromIndex && sameOrigin(fromIndex)) manifestPaths.unshift(new URL(fromIndex).pathname);
	let manifestFound = false;
	for (const path of [...new Set(manifestPaths)]) {
		const got = await get(`${origin}${path}`);
		if (got.status !== 200 || looksLikeHtml(got.body, got.headers["content-type"] ?? "")) continue;
		let parsed: { networks?: { name?: string }[]; actions?: { agentTools?: string[] }; manifest?: string } | null = null;
		try {
			parsed = JSON.parse(got.body);
		} catch {
			continue;
		}
		if (parsed?.networks?.length) {
			manifestFound = true;
			agentDocs.set(`${origin}${path}`, path);
			const tools = parsed.actions?.agentTools?.length ?? 0;
			add("Operable", "pass", "agent manifest", `${path}: network ${parsed.networks.map((network) => network.name).join(", ")}, ${tools} site action${tools === 1 ? "" : "s"} offered as tools`);
			if (got.headers["access-control-allow-origin"] !== "*") add("Operable", "warn", "the manifest has no open CORS header", "Other agent sites fetch it from their own origin.");
			break;
		}
	}
	if (!manifestFound) add("Operable", "info", "no agent manifest", "No open agentic web network at /agent-manifest.json, /agent/agent-manifest.json or in llms.txt. This rung is optional.");
	const others: [string, string][] = [
		["/.well-known/agent-card.json", "A2A agent card"],
		["/.well-known/agent.json", "A2A agent card (older name)"],
		["/.well-known/ai-plugin.json", "plugin manifest"],
		["/openapi.json", "OpenAPI description"],
	];
	const seen: string[] = [];
	for (const [path, name] of others) {
		const got = await get(`${origin}${path}`);
		if (got.status !== 200 || looksLikeHtml(got.body, got.headers["content-type"] ?? "")) continue;
		try {
			JSON.parse(got.body);
			seen.push(`${path} (${name})`);
		} catch {
			// Not JSON: not what the path promises.
		}
	}
	if (seen.length > 0) add("Operable", "info", "other descriptions found", seen.join(", "));

	// ----------------------------------------------------------------- Cost
	// Each document was fetched once above, which fills a cold cache. The second
	// answer shows where a steady read is served from.
	for (const [url, label] of agentDocs) {
		const got = await get(url);
		const verdict: CacheVerdict = classifyCache(got.headers);
		const line = describeVerdict(verdict);
		if (verdict.served === "cache") add("Cost", "pass", `${label} is served without your server`, line);
		else if (verdict.served === "origin") add("Cost", "warn", `${label} reaches your origin on a repeat read`, `${line}. On a serverless host that is a function call for every agent that reads it. Ask once more: some caches need two reads to fill.`);
		else add("Cost", "info", `${label}: cannot tell who answered`, line);
	}
	if (!args.includes("--no-404")) {
		const missing = `${origin}/agentify-audit-${Math.random().toString(36).slice(2, 10)}.json`;
		const got = await get(missing);
		const verdict = classifyCache(got.headers);
		if (got.status === 200) {
			add("Cost", "fail", "a missing file answers 200", "The site returns a page for an address that does not exist. An agent that asks for a document by convention reads your app shell as if it were the document.");
		} else if (verdict.served === "origin") {
			add("Cost", "warn", "a missing file runs your server", `${got.status}, ${describeVerdict(verdict)}. Every path a tool asks for by convention (/llms.txt, /agent-manifest.json, /favicon.ico) should exist as a file, or each ask is a function call.`);
		} else {
			add("Cost", verdict.served === "cache" ? "pass" : "info", "a missing file", `${got.status}, ${describeVerdict(verdict)}`);
		}
	}

	// --------------------------------------------------------------- output
	if (args.includes("--json")) {
		console.log(JSON.stringify({ site: origin, page: pageUrl, checks }, null, 2));
		return;
	}
	console.log(`\nAgent audit of ${origin}`);
	console.log(`Sample page: ${short(pageUrl)}\n`);
	for (const rung of ["Findable", "Readable", "Operable", "Cost"] as const) {
		const mine = checks.filter((check) => check.rung === rung);
		const count = (status: Status) => mine.filter((check) => check.status === status).length;
		console.log(`${rung}  (${count("pass")} ok, ${count("fail")} failed, ${count("warn")} to look at)`);
		for (const check of mine) {
			console.log(`  ${MARK[check.status]}  ${check.title}`);
			if (check.detail) console.log(`        ${check.detail}`);
		}
		console.log("");
	}
	const failed = checks.filter((check) => check.status === "fail").length;
	const warned = checks.filter((check) => check.status === "warn").length;
	console.log(failed === 0 && warned === 0 ? "Nothing failed." : `${failed} failed, ${warned} to look at. Fix the lowest rung first.`);
	console.log("Cost lines are read from cache headers. Count a real page view with page-cost.ts, and trust your host's function log over both.");
}

if (import.meta.main) await main();
