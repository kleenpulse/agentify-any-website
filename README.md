# agentify-any-website

Makes a coding agent turn your website into one AI agents can find, read and use, one rung at a time, and proves it costs you nothing to serve.

## Install

```bash
npx skills add kleenpulse/agentify-any-website
```

Works with Claude Code, Codex, Cursor, Copilot, and anything else that reads `SKILL.md`. The two scripts need [Bun](https://bun.sh). The page probe also needs Chrome, Chromium or Edge.

## Credit

The on-page assistant and the calls between agent sites build on the open agentic web by **Cognizant AI Labs**: the [`agentify-website` skill](https://github.com/cognizant-ai-labs/agentic-web/tree/main/skills/agentify-website) and the [Worldwide Agentic Web spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md) (Apache 2.0), with the [nsdeploy](https://github.com/cognizant-ai-lab/nsdeploy) browser runtime. This skill sends you there for that part and copies none of it. The `llms.txt` index and the `.md` twin of a page come from [llmstxt.org](https://llmstxt.org).

What is this skill's own: the ladder, the audit and page-cost scripts, the static-file method, the notes for framework apps, the free-tier guard, and every measured trap. They come from making one real app agentic, [Motion Garden](https://motion-garden.netlify.app) ([source](https://github.com/kleenpulse/shadow-garden), MIT), a Next.js 16 app on Netlify. It is not affiliated with or endorsed by Cognizant AI Labs, llmstxt.org, Netlify or Vercel.

## Why this one

Ask an agent to "make my site work with AI" and you get a chat widget. The widget has nothing true to read, so it invents. It loads on every page, so it slows the site. And on a host that bills by the function call, it quietly runs your server on every page view.

This skill goes the other way. It starts with what costs nothing and helps every agent: an index and a text version of every page, built as files. The assistant comes after that, runs in the visitor's browser on the visitor's key, and calls the site's own functions. Every step is checked with a count from a real run.

## The ladder

| Rung | The site is | What ships |
| --- | --- | --- |
| 1 | Findable | `/llms.txt`, a `robots.txt` that lets agents in |
| 2 | Readable | A Markdown twin of every page, facts as JSON, open CORS, all static files |
| 3 | Operable | The site's own functions as tools, for an assistant on the page and for other agent sites |
| 4 | Generous | A few free questions a day on the site's key, behind a guard |

Rungs 1 and 2 fit any website and need no AI model.

## What it does

- **Audits a live site** with `references/audit.ts`: is there an index, do its links answer, does a page have text without scripts, does it have a Markdown twin, does the site publish tools, and does an agent's read reach your server.
- **Counts what a page view costs** with `references/page-cost.ts`: it opens the page in a real browser, reloads it, and lists every request to your origin that no cache answered.
- **Reads cache headers for you** on Netlify, Vercel, Cloudflare and anything that sends `X-Cache` or `Age`.
- **Builds the index and the twins from the site's own data**, as files built once per deploy.
- **Adapts the open agentic web to a framework app**: a bridge from the actions to the app's own state, loading in the background, one chat that survives page changes, headers that a CDN needs set twice.
- **Guards a free tier**: the site's own pages only, its agents' exact system message, its own tools, a model the server picks, a count in which no call runs free.
- **Fails the build** when a prebuilt Next.js page would run a function on every view (`references/check-static-pages.ts`).
- **Ends with numbers**: server calls per page view, per chat open and per question, before and after.

## What it refuses to do

- Build an assistant before the site is readable
- Hand-write a second copy of the site's content for agents
- Let the assistant state a fact that did not come from a tool result
- Add a server call to every page view
- Open a `robots.txt` path the owner closed
- Put a key, a token or personal data in a published file
- Put the site's key behind an endpoint that takes the caller's model, prompt or tools
- Call a change "faster" or "cheaper" without a measurement
- Edit the runtime copy or a generated file by hand

## Usage

- "Make my site agent-ready"
- "Audit my site for AI agents"
- "Add llms.txt and a Markdown version of every docs page"
- "Add an assistant that can search the catalog and change the live preview"
- "My assistant costs a function call on every page view. Find out why."
- "Give visitors two free questions a day without getting my key abused"

Run the scripts on their own, without an agent:

```bash
bun references/audit.ts https://your-site.com
bun references/audit.ts https://your-site.com --page /docs/install --json
bun references/page-cost.ts https://your-site.com/some/page
bun references/page-cost.ts https://your-site.com/some/page --wait 12000 --all
```

Run this one from a Next.js project after `next build`:

```bash
bun path/to/references/check-static-pages.ts
```

`audit.ts` sends about 20 to 30 GET requests to the site you name, as `agentify-audit/1.0`, and nothing anywhere else. One of them asks for a file that does not exist, which can run one function on your host; `--no-404` skips it. `page-cost.ts` opens the page with an empty browser profile, so your analytics count one new visitor per run.

## What was checked

On 21 Nov 2026:

- `audit.ts` was run against a Netlify site, a Vercel site and two Cloudflare sites. `page-cost.ts` was run against the Netlify site with Bun 1.4.5 and Chrome on Windows. `check-static-pages.ts` was run against a Next.js 16.4.5 build of 333 pages.
- The pure parts (cache headers, `robots.txt`, `llms.txt`, page text) have unit tests: `bun test references/`.
- Every line marked *measured* in `references/` was measured on the Next.js 16.4.5 app on Netlify named above.

Not checked here:

- The Vercel and Cloudflare header values other than `HIT`. They follow what each host documents.
- `page-cost.ts` on macOS and Linux.
- One address that answers Markdown by the `Accept` header. The skill uses a second address (`.md`).
- A free tier on a paid model. The live one runs free models only.
- The edge function fix for answers cut near 35 seconds.

## License

MIT
