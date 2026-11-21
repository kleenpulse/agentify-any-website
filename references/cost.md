# Cost: count the server calls

On a host that bills by the function call, an agent surface can cost more than the site it sits on. Each page view, each agent's read and each deploy can run functions that nobody wrote on purpose. This file is how to count them and the traps we hit.

Everything here was measured on one site on 21 Nov 2026: Next.js 16.4.5 with Cache Components, on Netlify. The method works on any host. The traps are that stack's.

## 1. Write the budget first

Before you build, fill in this table and show it to the owner. Fill it in again, from a count, before you ship.

| Event | Server calls |
| --- | --- |
| A page view | 0 |
| An agent reads the index, a twin or a JSON document | 0 |
| A search | 1 |
| The visitor opens the chat | 0, or 1 with a free tier |
| A question on the visitor's own key | 0 |
| A question on the free tier | the model calls |
| The first load of each page after a deploy | a few, once |

## 2. Count, do not read

Reading the code misses calls. Three tools, weakest first:

1. **`audit.ts`** asks for each agent document twice and reads who answered the second time.
2. **`page-cost.ts`** opens a page in a real browser with an empty profile, watches, reloads, and lists every request to your origin that no cache answered.
3. **Your host's function log** is the proof. The two scripts read headers.

Rules for a count on a live site:

- An empty browser profile is a new visitor. Analytics count it. Keep live runs few, and say how many you made.
- Right after a deploy the caches are empty. Run twice and read the second.
- Print the address the browser ended on. A wrong address loads an error page and still prints numbers. (In Git Bash on Windows, a bare `/path` argument is rewritten into a Windows path. Pass whole addresses.)

## 3. Reading the cache headers

| Host | Header | The CDN answered | Your origin answered |
| --- | --- | --- | --- |
| Netlify | `Cache-Status` | `"Netlify Edge"; hit` or `"Netlify Durable"; hit` | `"Netlify Durable"; fwd=bypass`, `fwd=stale`, `fwd=uri-miss` or `fwd=vary-miss` |
| Vercel | `X-Vercel-Cache` | `HIT`, `STALE`, `PRERENDER` | `MISS`, `BYPASS`, `REVALIDATED` |
| Cloudflare | `CF-Cache-Status` | `HIT`, `STALE`, `UPDATING`, `REVALIDATED` | `MISS`, `EXPIRED`, `DYNAMIC`, `BYPASS` |
| Others | `X-Cache`, `Age` | `Hit`, or an `Age` above 0 | `Miss` |

The Netlify rows were measured. The others are what each host documents, with `HIT` seen on one live site each. Check them on yours.

On Netlify, a file from the deploy (a script chunk, a file from the public folder) shows only `"Netlify Edge"; fwd=miss` with an `ETag` that ends in `-ssl`. That is a read from the file store, not a function. `"Next.js"; hit` alone means the framework's own cache answered inside a function that still ran.

## 4. What we found on a real site

| | Before | After |
| --- | --- | --- |
| First view of a page | 3 function calls | 1 (the view count) |
| Reload, back, forward, repeat view | 3 | 0 |
| Next page in the same visit | 2 | 1 if new to this browser, else 0 |
| Opening the chat | 1 | 1 (the count; a free tier is on) |
| An agent reads a document | 1 each time | 0 once stored |

The three calls were the page itself, a view-count request, and a 404 for a file a script asked for by convention.

It did not make the page faster. First paint was about the same, and the part of the page that reads the URL appeared about 0.6 seconds later, because it now renders in the browser. Do not write "faster" in a changelog without a measurement.

## 5. The traps

Each one: what you see, why, the fix, how to check.

**A prebuilt page that still runs a function on every view.**
The page answers `Cache-Control: private, no-store`. A server component reads a file or fetches outside a `"use cache"` function. Under Cache Components that leaves a part of the page for a function to fill on each request, even inside `<Suspense>`. Next gives no warning, and the build's route table prints the same symbol either way. Fix: move the read into a `"use cache"` function that takes and returns plain data. Check: `check-static-pages.ts` after the build. Reading the URL in a client component (`useSearchParams`) was not the cause, whatever old comments say; we tested it.

**A route handler with `generateStaticParams` that is still a function.**
Same cause, same fix. Check the build's route list: `●` or `○`, not `ƒ`.

**A cache life with a time limit.**
With `cacheLife("max")` (30 days) on a page's cached reads, the pages became the only ones with a revalidate time, and Netlify would not store their prefetch data: the lifetime came back as minus 30 days and every prefetch ran a function. With the same setting on document routes, each document needed three requests after a deploy before it was stored. Fix for text that only a deploy can change: `cacheLife({ revalidate: Infinity, expire: Infinity })`. With it, each document was stored after one request. Check: `check-static-pages.ts` fails on any prebuilt page or route handler with a revalidate time.

**A file that does not exist.**
A request for a missing file falls through to the app's 404 page, which is a function. A script or a tool asks for files by convention (`/agent-manifest.json` at the site root, `/favicon.ico`, `/llms.txt`), on every page view. Fix: make each such path a real file. Check: `audit.ts` asks for a missing file and reports who answered. `page-cost.ts` shows the ones your own pages ask for.

**A view count on every view.**
One request per page view, to count it. If the server already counts a visitor once per page, the repeat requests buy nothing. Fix: remember in `localStorage` which pages this browser reported, send once, and forget the page again only if the request failed.

**The opposite mistake: a per-visitor route built once.**
A `GET` handler that can return before it reads the request is written as a static file at build time, and everyone gets one answer. Fix: `await connection()` first. Check the route list: it must be `ƒ`.

**A static file cannot answer to a query.**
`?part=2` on a static document returns the whole document, and Netlify's cache key ignores unknown query parameters. Fix: put the choice in the path, or let the caller pick from the document.

**The deploy is the cost that is left.**
Each deploy empties the cache. *Measured:* the first load of each page then ran about 15 functions once (the page, plus its link prefetches, whose addresses carry a hash of the page they are asked from). So push in batches. Then find out what starts a deploy: on this site a webhook fired on every push to every branch, and a release bot's branch push made a second production deploy of the same commit. Fix: start one deploy from CI, on the main branch only, after the checks pass.

**A static page needs a placeholder of the same size.**
When a page becomes a file, a client component that reads the URL renders only in the browser, and its fallback is what sits in the HTML until then. A fallback of another height makes the page jump: layout shift was 0.09 to 0.37 with a small placeholder, and 0 to 0.007 with one that mirrors the real sizes. Share the sizes between the two in one file. Measure at phone, tablet and desktop widths.

**The cache in dev.**
Under `next dev`, a `"use cache"` function kept old text after its file was edited. Read fresh in dev.

## 6. Keep it that way

- Run `check-static-pages.ts` as the last step of the host's build command. A change that makes a page run a function then fails the deploy, and the last good deploy stays live.
- Put the static-route checks from `readable.md` and `operable.md` in CI.
- State the call counts in every change that touches the agent surface.
