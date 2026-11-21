#!/usr/bin/env bun
// Counts, with a real browser, the requests one page view sends to your own
// origin that a cache did not answer. On a serverless host each of those is a
// function call you are billed for.
//
//   bun page-cost.ts https://example.com/some/page
//   bun page-cost.ts https://example.com/some/page --wait 12000 --all
//   bun page-cost.ts https://example.com/some/page --seed my-viewed-key='["some-page"]'
//
// It opens the page in headless Chrome with an empty profile (a first visit),
// waits, then reloads (a repeat visit), and prints both counts.
//
// Why a browser: reading the code misses requests. Scripts ask for files by
// convention, links are prefetched, and analytics fire after load. A request
// for a file that does not exist falls through to the app's 404, which is a
// function call nobody wrote.
//
// Know before you run it on a live site:
// - An empty profile is a new visitor. Your analytics will count it, and so
//   will anything that counts a first view. Use --seed to set localStorage
//   values first if the site remembers visitors there.
// - The verdicts are read from cache headers (cache-status.ts). Your host's
//   function log is the proof.
// - Right after a deploy the caches are empty, so the first runs count the
//   warm-up. Run it twice and read the second.
//
// Needs Chrome, Chromium or Edge. Set CHROME_PATH if it is not found.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyCache, describeVerdict, type Served } from "./cache-status";

function findChrome(): string | null {
	if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
	const local = process.env.LOCALAPPDATA ?? "";
	const candidates =
		process.platform === "win32"
			? [
					"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
					"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
					path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
					"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
					"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
				]
			: process.platform === "darwin"
				? [
						"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
						"/Applications/Chromium.app/Contents/MacOS/Chromium",
						"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
					]
				: [];
	for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
	for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
		const found = Bun.which(name);
		if (found) return found;
	}
	return null;
}

interface Row {
	method: string;
	url: string;
	status: number;
	type: string;
	served: Served;
	why: string;
}

interface Step {
	step: string;
	href: string;
	title: string;
	sameOrigin: number;
	rows: Row[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function usage(): never {
	console.log(
		[
			"Usage: bun page-cost.ts <page url> [--wait <ms>] [--seed <key>=<value>]... [--all] [--json]",
			"",
			"  --wait <ms>            how long to watch after each load (default 8000)",
			"  --seed <key>=<value>   set a localStorage value before the page's scripts run (repeatable)",
			"  --all                  list every same-origin request, not only the ones that reached the origin",
			"  --json                 print the result as JSON",
		].join("\n"),
	);
	process.exit(1);
}

async function main() {
	const args = process.argv.slice(2);
	const valued = new Set(["--wait", "--seed"]);
	const target = args.find((arg, index) => !arg.startsWith("--") && !valued.has(args[index - 1]));
	if (!target || args.includes("--help")) usage();
	let page: URL;
	try {
		page = new URL(target);
	} catch {
		usage();
	}
	const wait = args.includes("--wait") ? Number(args[args.indexOf("--wait") + 1]) || 8000 : 8000;
	const seeds = args.flatMap((arg, index) => (arg === "--seed" && args[index + 1]?.includes("=") ? [args[index + 1]] : []));
	const chromePath = findChrome();
	if (!chromePath) {
		console.error("No Chrome, Chromium or Edge found. Set CHROME_PATH to the browser's program file.");
		process.exit(1);
	}

	const profile = mkdtempSync(path.join(tmpdir(), "page-cost-"));
	const port = 9300 + Math.floor(Math.random() * 600);
	const chrome = spawn(
		chromePath,
		["--headless=new", "--enable-unsafe-swiftshader", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1400,900", "about:blank"],
		{ stdio: "ignore" },
	);
	const steps: Step[] = [];
	let failure: string | null = null;
	try {
		let address: string | null = null;
		for (let attempt = 0; attempt < 60 && !address; attempt++) {
			try {
				const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl?: string }[];
				address = list.find((entry) => entry.type === "page")?.webSocketDebuggerUrl ?? null;
			} catch {
				// Chrome is still starting.
			}
			if (!address) await sleep(250);
		}
		if (!address) throw new Error("Chrome did not open its debugging port.");
		const socket = new WebSocket(address);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("Could not connect to Chrome."));
		});

		let nextId = 0;
		const waiting = new Map<number, (message: { result?: any }) => void>();
		const methods = new Map<string, string>();
		let rows: Row[] = [];
		let sameOrigin = 0;
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id && waiting.has(message.id)) {
				waiting.get(message.id)?.(message);
				waiting.delete(message.id);
				return;
			}
			if (message.method === "Network.requestWillBeSent") {
				methods.set(message.params.requestId, message.params.request.method);
				return;
			}
			if (message.method !== "Network.responseReceived") return;
			const { response, requestId, type } = message.params;
			let url: URL;
			try {
				url = new URL(response.url);
			} catch {
				return;
			}
			if (url.origin !== page.origin) return;
			sameOrigin++;
			const method = methods.get(requestId) ?? "GET";
			const where = (url.pathname + url.search).replace(/([?&]_rsc=)\w+/, "$1…");
			const base = { method, url: where.length > 90 ? `${where.slice(0, 89)}…` : where, status: response.status, type };
			// The browser's own cache or a service worker answered: nothing was sent.
			if (response.fromDiskCache || response.fromPrefetchCache || response.fromServiceWorker) {
				rows.push({ ...base, served: "cache", why: "from the browser's own cache" });
				return;
			}
			const headers = Object.fromEntries(Object.entries(response.headers as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
			const verdict = classifyCache(headers);
			// A cache does not answer a POST, PUT or DELETE.
			if (verdict.served === "unknown" && method !== "GET" && method !== "HEAD") {
				rows.push({ ...base, served: "origin", why: `reached the origin (a ${method} is not served from cache)` });
				return;
			}
			rows.push({ ...base, served: verdict.served, why: describeVerdict(verdict) });
		};
		const send = (method: string, params: Record<string, unknown> = {}) =>
			new Promise<{ result?: any }>((resolve) => {
				const id = ++nextId;
				waiting.set(id, resolve);
				socket.send(JSON.stringify({ id, method, params }));
			});
		const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
		const step = async (name: string, action: () => Promise<unknown>) => {
			rows = [];
			sameOrigin = 0;
			await action();
			await sleep(wait);
			steps.push({
				step: name,
				href: String(await evaluate("location.href")),
				title: String(await evaluate("document.title")),
				sameOrigin,
				rows,
			});
		};

		await send("Page.enable");
		await send("Network.enable");
		for (const seed of seeds) {
			const key = seed.slice(0, seed.indexOf("="));
			const value = seed.slice(seed.indexOf("=") + 1);
			await send("Page.addScriptToEvaluateOnNewDocument", {
				source: `try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); } catch {}`,
			});
		}
		await step("first view", () => send("Page.navigate", { url: page.href }));
		await step("reload", () => send("Page.reload"));
		socket.close();
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	} finally {
		chrome.kill();
		await sleep(500);
		try {
			rmSync(profile, { recursive: true, force: true });
		} catch {
			// Chrome can hold the folder a moment longer. It is in the temp folder.
		}
	}

	if (args.includes("--json")) {
		console.log(JSON.stringify({ page: page.href, waitMs: wait, steps, error: failure }, null, 2));
		process.exit(failure ? 1 : 0);
	}
	if (failure) {
		console.error(`page-cost: ${failure}`);
		process.exit(1);
	}
	console.log(`\nPage cost of ${page.href}`);
	console.log(`Watched ${wait / 1000} s after each load.\n`);
	for (const result of steps) {
		const origin = result.rows.filter((row) => row.served === "origin");
		const unknown = result.rows.filter((row) => row.served === "unknown");
		console.log(`${result.step}: ${origin.length} reached the origin, ${unknown.length} unknown, ${result.sameOrigin} same-origin requests in all`);
		console.log(`  page shown: ${result.href}  "${result.title}"`);
		const all = args.includes("--all");
		const listed = all ? result.rows : [...origin, ...unknown.slice(0, 5)];
		for (const row of listed) console.log(`  ${row.served === "origin" ? "ORIGIN " : row.served === "unknown" ? "unknown" : "cache  "} ${row.method} ${row.url} -> ${row.status}  ${row.why}`);
		if (!all && unknown.length > 5) console.log(`  ... and ${unknown.length - 5} more unknown (list them with --all)`);
		console.log("");
	}
	if (!steps.every((result) => result.href.startsWith(page.origin))) {
		console.log("The browser did not end on the page you named. Check the address: these counts describe another page.");
	}
	console.log("Each ORIGIN line is a request your server answered. On a serverless host, that is one function call.");
}

if (import.meta.main) await main();
