// Reads a response's cache headers and says who answered: the CDN, or your
// origin (on a serverless host, a function you are billed for).
//
// It is a reading of headers, not a bill. Hosts differ, and a header can be
// missing. Treat "origin" as "go and look", and your host's own function log as
// the proof.
//
// Pure, no imports: audit.ts and page-cost.ts share it, and audit.test.ts
// checks it against header sets copied from real responses.

export type Served = "cache" | "origin" | "unknown";

export interface CacheVerdict {
	served: Served;
	/** Which header decided it. */
	by: string;
	/** The value that decided it, for the report. */
	detail: string;
}

type Headers = Record<string, string | undefined>;

function entry(status: string, name: RegExp): string | null {
	return status.split(",").map((part) => part.trim()).find((part) => name.test(part)) ?? null;
}

/** RFC 9211: a cache that answered itself says `hit`, one that asked upstream says `fwd=...`. */
const isHit = (part: string) => /;\s*hit\b/.test(part) && !/;\s*fwd=/.test(part);

/**
 * Who answered this response.
 *
 * @param headers Response headers with lowercase names. A header sent more
 *   than once must be joined with ", " (fetch does this) or with newlines
 *   (Chrome's DevTools protocol does this).
 */
export function classifyCache(headers: Headers): CacheVerdict {
	const value = (name: string) => (headers[name] ?? "").replace(/\r?\n/g, ", ").trim();
	const status = value("cache-status");
	const control = value("cache-control").toLowerCase();

	// Netlify. Its caches are named in Cache-Status, from the origin outwards:
	// "Next.js" (the framework's own cache, inside the function), "Netlify
	// Durable" (shared by all edge nodes) and "Netlify Edge" (one node).
	if (/"Netlify (Edge|Durable)"/.test(status)) {
		const edge = entry(status, /"Netlify Edge"/);
		const durable = entry(status, /"Netlify Durable"/);
		if (edge && isHit(edge)) return { served: "cache", by: "cache-status", detail: edge };
		if (durable && isHit(durable)) return { served: "cache", by: "cache-status", detail: durable };
		// The durable cache passed the request on: a function ran. Its reason is
		// in fwd (bypass, stale, uri-miss, vary-miss, miss).
		if (durable) return { served: "origin", by: "cache-status", detail: durable };
		// Only the edge node is named and it missed. For a file in the deploy that
		// is a read from Netlify's file store, which runs nothing. Netlify gives
		// such files an ETag that ends in -ssl, and one of two Cache-Control
		// values. A plain Netlify Function can also look like an edge miss, so
		// without those marks the answer stays unknown.
		const deployedFile =
			/-ssl"?$/.test(value("etag")) || control === "public,max-age=0,must-revalidate" || /\bimmutable\b/.test(control);
		if (deployedFile) return { served: "cache", by: "cache-status", detail: "a deployed file, read from Netlify's file store" };
		return { served: "unknown", by: "cache-status", detail: edge ?? status };
	}

	// Vercel.
	const vercel = value("x-vercel-cache").toUpperCase();
	if (vercel) {
		if (["HIT", "STALE", "PRERENDER"].includes(vercel)) return { served: "cache", by: "x-vercel-cache", detail: vercel };
		return { served: "origin", by: "x-vercel-cache", detail: vercel };
	}

	// Cloudflare. "origin" here is whatever sits behind Cloudflare.
	const cloudflare = value("cf-cache-status").toUpperCase();
	if (cloudflare) {
		if (["HIT", "STALE", "UPDATING", "REVALIDATED"].includes(cloudflare)) return { served: "cache", by: "cf-cache-status", detail: cloudflare };
		return { served: "origin", by: "cf-cache-status", detail: cloudflare };
	}

	// CloudFront, Fastly and others that send X-Cache.
	const xCache = value("x-cache");
	if (/\bhit\b/i.test(xCache)) return { served: "cache", by: "x-cache", detail: xCache };
	if (/\bmiss\b/i.test(xCache)) return { served: "origin", by: "x-cache", detail: xCache };

	// Any other cache that follows RFC 9211.
	if (status) {
		const parts = status.split(",").map((part) => part.trim());
		const last = parts[parts.length - 1];
		if (isHit(last)) return { served: "cache", by: "cache-status", detail: last };
		if (/;\s*fwd=/.test(last)) return { served: "origin", by: "cache-status", detail: last };
	}

	// No cache named itself. An Age above zero means some cache held the response.
	const age = Number(value("age"));
	if (Number.isFinite(age) && age > 0) return { served: "cache", by: "age", detail: `age ${age}` };
	if (/\b(no-store|private)\b/.test(control)) return { served: "origin", by: "cache-control", detail: control };
	return { served: "unknown", by: "none", detail: control || "no cache headers" };
}

/** One short line for a report. */
export function describeVerdict(verdict: CacheVerdict): string {
	const who = verdict.served === "cache" ? "from cache" : verdict.served === "origin" ? "reached the origin" : "unknown";
	return `${who} (${verdict.by === "none" ? verdict.detail : `${verdict.by}: ${verdict.detail.replace(/"/g, "")}`})`;
}
