# Rungs 1 and 2: findable and readable

How to let an agent find what a site has and read it as text. Nothing here needs an AI model, a key or a server. It works for any site, and it is where most of the value is.

Everything marked *measured* was measured on a Next.js 16.4.5 app on Netlify on 21 Nov 2026. The Next.js code is one way to do it. The rules hold for any stack: build the files during the build.

## How an agent meets a site

Plan for the weakest reader:

- It fetches one address and reads the answer. It runs no script.
- It has limited room. A long answer is cut short or costs its user money.
- It cannot guess an address. It follows links and stated patterns.
- It often runs in a browser on another origin, so it needs a CORS header.

So the site needs an index, then one complete document per thing, then exact addresses for the data.

## 1. robots.txt

Who may read the site is the owner's decision. Report what the file does today and ask before changing it. Never open a path the owner closed.

Agent reads usually live under an API path, and the rest of the API should stay closed. The longest matching path wins (RFC 9309), so open only that folder:

```
User-agent: *
Allow: /
Allow: /api/agent/
Disallow: /api/
Sitemap: https://example.com/sitemap.xml
```

## 2. /llms.txt, the index

The shape, from [llmstxt.org](https://llmstxt.org): one `# Title`, a `> summary`, then `## Section` blocks of links, each `- [Name](url): one line`. A section named `## Optional` holds links an agent may skip.

Rules:

1. **Generate it from the data the pages use**, in the build. A hand-kept index goes out of date on the first new page.
2. **It stays an index.** One line per page. The content lives in each page's own document. Measured: 154 entries and the instructions below came to 36,282 characters.
3. **Give each line a fact to choose by.** "Molten chrome." tells an agent nothing. A line like "Flowing lines that react to the pointer (9 props)" does. When a description opens with a two-word hook, borrow the next sentence.
4. **Open with how to use the site.** How to get the full content of a page (add `.md`), what stack the content assumes, the license, what is free.
5. **List the data addresses with their exact shape.** The method, the path, each parameter with its limits ("`limit` 1 to 12, default 6"), and what comes back. An agent cannot discover a query parameter.
6. **Absolute addresses**, and `Content-Type: text/plain; charset=utf-8`.
7. **It must not answer with a web page.** Many apps answer 200 with their app shell for any unknown path. An agent then reads HTML as the index. `audit.ts` fails this.

In Next.js this is one route handler that reads no request, so the build writes it as a file:

```ts
// app/llms.txt/route.ts
export function GET(): Response {
	return new Response(body(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
```

## 3. A Markdown twin for every page

The twin is the page's content as one text document at a second address.

- **Address:** the page's address with `.md` added (`/components/waves` and `/components/waves.md`). For an address that ends in `/`, the convention is `index.html.md`.
- **The page names its twin**, so an agent that landed on the page can find it:
  ```html
  <link rel="alternate" type="text/markdown" href="https://example.com/components/waves.md" />
  ```
  In Next.js, in the page's metadata:
  ```ts
  alternates: { canonical: url, types: { "text/markdown": `${url}.md` } },
  ```
- **The twin names its page**, so a search engine does not treat it as a copy: `Link: <https://example.com/components/waves>; rel="canonical"`.
- **Headers:** `Content-Type: text/markdown; charset=utf-8` and `Access-Control-Allow-Origin: *`.
- **A missing twin answers 404 in plain text** with a pointer to `/llms.txt`. Never the app's HTML 404.

**Write the twin for the agent's job, not as the page turned into Markdown.** Ask what the agent needs to finish its task without opening the page. For a component catalog that was: every source file, the install command, the props table with defaults and ranges, a usage example and the integration rules. If the site has a "copy for agent" or "copy as prompt" button, the twin is that same text. One function builds both.

In Next.js the twin is a route handler behind a rewrite:

```ts
// next.config.ts
async rewrites() {
	return [{ source: "/components/:slug([a-z0-9-]+)\\.md", destination: "/api/agent/component/:slug/md" }];
}
```

Give the twin its own route. Do not make it a flag on another route (`?format=md`): *measured*, the query of a rewrite's destination does not reach the handler's request, and a static file cannot answer to a query at all (section 5).

Another way is one address that answers by the `Accept` header. We did not build or measure that. If you do, send `Vary: Accept`, and check that your CDN keys its cache on that header, or a browser gets the Markdown.

## 4. Facts as JSON

Give an agent the same facts in a shape it can pick from:

| Document | Holds |
| --- | --- |
| describe | The thing's options, dependencies, install commands, files, links |
| full text | The same text as the twin, with its size in characters |
| source | Every file, each split into parts |
| search | The one read that needs a server, because it takes a query |

Rules for the shape:

1. **`{ "ok": true, ... }` or `{ "ok": false, "reason": "..." }`**, with a real status code. The reason is one sentence the agent can pass to its user, and it says what to do next: `No component with the slug "wavs". Search the catalog first.`
2. **State sizes** (`chars`) so the agent can decide before it reads.
3. **Split long text inside the document.** Each file carries `parts`, pieces of up to 28,000 characters cut on line ends. The caller takes the part it wants. A static file cannot do `?part=2`.
4. **Link everything.** Each document carries the page's address and the twin's address.
5. **Only public facts.** These documents are open to any origin. Nothing in them may depend on who asks.

If the site ships code, a registry file per item (for example a shadcn registry item at `/r/<name>.json`) lets a command line tool or an agent install it in one line. Generate it from the same data.

## 5. Every document is a static file

A document that changes only when the site is deployed should be built once and served by the CDN. Then an agent's read costs the site nothing. On a serverless host the other choice is a function call for every read by every agent.

1. **The handler must not read the request**: no query, no headers, no cookies. Name the parameter `_request` so a reviewer sees it.
2. **Build one answer per item.** In Next.js: `export const generateStaticParams`.
3. **In Next.js 16 with Cache Components, that is not enough.** *Measured:* a handler that reads files from disk stayed a function (`ƒ` in the build's route list) with `generateStaticParams` in place, and with no warning. Moving the read into a `"use cache"` function made it static (`●`):
   ```ts
   async function storedBrief(slug: string) {
   	"use cache";
   	cacheLife({ revalidate: Infinity, expire: Infinity });
   	return buildBrief(slug);
   }
   ```
   The function takes plain data (a slug, not an object) and returns plain data.
4. **Use a cache life that never revalidates** for text that only a deploy can change. *Measured* with `cacheLife("max")`, which revalidates after 30 days: after each deploy, the first answer for a document came with an `Age` over 30 days, and it took three requests (two function calls) before the CDN kept it. Documents with no time limit were kept after one. On pages, the same setting stopped Netlify from storing the page's prefetch data at all (see `cost.md`). We measured the fix on pages; for route handlers we measured only the problem.
5. **Tell the build which files the handlers read.** A file read through a path that comes from data is invisible to the build's file tracer, and a serverless host then ships without those files: every document comes out empty in production and fine on your machine. In Next.js, list the folders in `outputFileTracingIncludes` for each route.
6. **In dev, read fresh.** *Measured:* under `next dev`, a `"use cache"` function kept the old text after the file it reads was edited, until the server restarted. Export the plain builder in dev and the cached one in production.
7. **Read the build's route list.** Each document route must show as static. Then ask the live site twice and read the cache headers (`audit.ts` does this).

For other stacks the rule is the same and usually simpler: write the files during the build (an endpoint with static paths, or a script that writes into the public folder).

## 6. Headers

- `Access-Control-Allow-Origin: *` on public documents only. Never on a route that reads a cookie or a session.
- If a CDN serves the public folder without running the framework, headers set in the framework's config do not reach those files. *Measured* on Netlify: set them in both `next.config.ts` and `netlify.toml`.

## 7. Checks worth writing

Put these in one script that runs in CI:

- Every document route file has `generateStaticParams` and never touches the request.
- The index lists every item the site ships, and nothing it hides.
- Every file fits the part range the tools accept.
- The twin's text equals what the page's own copy button gives.
- The describe document's commands equal the ones the page shows.
