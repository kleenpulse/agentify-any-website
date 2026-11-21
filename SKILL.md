---
name: agentify-any-website
description: Make any website usable by AI agents, one rung at a time, without a server bill for it. Rung 1 findable (an llms.txt index, a robots.txt that lets agents in), rung 2 readable (a Markdown twin of every page, facts as JSON, open CORS, all built as static files), rung 3 operable (the site's own functions as tools for an on-page assistant and for other agent sites, on the open agentic web spec), rung 4 a free tier the site pays for, guarded so its key cannot be abused or billed. Starts with an audit script that scores a live URL and shows which agent reads reach your server, and a browser probe that counts server calls per page view. Carries the traps measured on a real Next.js app on Netlify - a prebuilt page that still runs a function on every view, a cache life that keeps documents from being stored, a missing file that costs a function call, a free-tier key behind a public URL. Use when the user says "agentify my website", "make my site agent-ready", "make my site AI-friendly", "add llms.txt", "let AI agents read my docs", "add a Markdown version of every page", "audit my site for AI agents", "is my site agent-friendly", "add an AI assistant to my site", "expose my site's functions as tools", "let agents use my app", "offer free AI questions on my site", or "my assistant costs a function call on every page view".
license: MIT
---

# Agentify Any Website: Readable First, and It Costs Nothing to Serve

You make a website usable by AI agents: first findable, then readable, then operable. You build each rung as files the CDN serves, and you prove with a count that an agent's read and a visitor's page view run nothing on the server.

The on-page assistant and the calls between agent sites (rung 3) come from the open agentic web: the `agentify-website` skill and the Worldwide Agentic Web spec in [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web) (Apache 2.0), and the nsdeploy browser runtime. The `llms.txt` index and the `.md` twin come from [llmstxt.org](https://llmstxt.org). The ladder, the two scripts, the static-file method, the free-tier guard and every measured trap are this skill's own, from making one real app agentic on a metered host. This skill is not affiliated with or endorsed by Cognizant AI Labs, llmstxt.org, Netlify or Vercel.

## When to Use

- Someone wants AI agents to find, read or use their site
- Someone asks whether their site is ready for agents, or wants it audited
- A site needs `llms.txt`, Markdown versions of its pages, or JSON that agents can read
- Someone wants an assistant on their site that can act on the page
- The site is a framework app (Next.js, React, Vue, Svelte), where the upstream skill's static-site steps do not fit as written
- An agent surface or an assistant is running up function calls

**Do not use for:** search ranking (this is not SEO), a general chatbot that does not use the site's own data, scraping someone else's site, or building an MCP server for an API with no website.

## Core Principle

**Give an agent what a person gets, as plain text and data, from files.** Readable comes before clever: an assistant with nothing true to read invents things. And a page view must cost the site nothing extra, or the owner turns the whole thing off.

## The Ladder

| Rung | The site is | What ships | Runs on the server |
| --- | --- | --- | --- |
| 1 | Findable | `/llms.txt`, a `robots.txt` that lets agents in, a sitemap | Nothing |
| 2 | Readable | A Markdown twin of every page, facts as JSON, open CORS | Nothing (search, if any) |
| 3 | Operable | The site's own functions as tools: an assistant on the page, public reads for other agent sites | Nothing. It runs in the visitor's browser on their key |
| 4 | Generous | A few free questions a day on the site's key | One guarded endpoint |

Rungs 1 and 2 fit every website and need no AI model. Stop there when the owner wants no assistant.

## Rules

### Order

1. **Audit before you change anything.** Run `references/audit.ts` on the live address and show the owner the report.
2. **Climb in order.** No rung 3 before rung 2 passes. No rung 4 unless the owner asks for it and sets the daily limits.
3. **Ask once.** Bring everything only the owner can decide as one list (below).

### Truth

4. **One source.** Every document an agent reads is generated from the same data the page renders. Never hand-write a second copy.
5. **The index stays an index.** `/llms.txt` holds one line per page and the exact shape of each data address. Content lives in each page's own document.
6. **Write the twin for the agent's job.** It holds what the agent needs to finish the task without opening the page. It is not the page turned into Markdown.
7. **Never invent.** The assistant takes facts only from tool results. Its instructions list what the site cannot do, and one sample query is a request it must decline.

### Cost

8. **Every document is a static file.** Its handler never reads the request. A choice that a query string would make moves into the path or to the caller.
9. **A page view runs nothing on the server for the agent surface.** The assistant loads from files, in the background, when the browser is idle.
10. **Every path a tool asks for by convention is a real file.** A missing file falls through to the app's 404, which is a function call.
11. **Count with a browser, not by reading code.** Run `references/page-cost.ts` and state the calls per page view, per chat open and per question before you ship.
12. **Real numbers only.** A count or a speed claim comes from a run. If you have not measured it, say so.

### Actions

13. **An action calls the same function the page's own button calls**, and checks its input against the same schema. No business rule lives in the actions module.
14. **Refuse with data, never by throwing**: `{ok: false, reason, field}`, and change nothing. One bad value refuses the whole batch.
15. **Mark every action's effect honestly**: read, write (the visitor can undo it on the page) or irreversible (the visitor confirms). When unsure, irreversible.
16. **Long text stays out of the chat.** Set a limit for one tool result, list the files and link the twin when a document is over it, and give long reads to a helper agent.
17. **A starter prompt fills the input. It never sends.**

### Safety

18. **A key behind a public address is narrowed before it is paid for**: the site's own pages only, its agents' exact system message, its own tools, a model and an output cap the server picks, and a count in which no call runs before a question is counted. The full list is `references/free-tier.md`.
19. **Say where the visitor's messages go** before the first message.
20. **A check script guards all of it in CI**: static routes, action logic, and that the manifest, the network file and the server agree.

### What only the owner can decide

Bring these as one list, each with what it changes:

- Which AI agents `robots.txt` lets in
- Which operations are irreversible
- What is public: every document here is open to any origin
- Whether there is a free tier, its daily limits, and who pays
- Any key or secret
- Publishing: a deploy, a listing in an agent directory

## What to Keep (Untouchables)

- **The site works without the assistant.** If it fails to load, the page is unchanged.
- **`robots.txt` rules the owner wrote.** Report them. Never open a closed path on your own.
- **The runtime copy and every generated file.** Change the source and rebuild.
- **Keys, tokens and personal data** stay out of every published file. The network file, with its instructions, is public.
- **A visitor's name, email or account details** never go into a request to another site.
- **The site's business rules.** They stay in the site's own functions.

## Method

1. **Audit.** `bun references/audit.ts https://the-site` and, for one real page, `bun references/page-cost.ts https://the-site/a-page`. Keep both outputs as the "before".
2. **Inventory.** List the site's data, its page state, its operations (can the visitor undo each one?), and what it does not support. Find the one source every page is built from.
3. **Rung 1.** Follow `references/readable.md`, sections 1 and 2.
4. **Rung 2.** Follow `references/readable.md`, sections 3 to 7. Build the site, confirm each document route is static, deploy, and run the audit again.
5. **Stop and report** if the owner asked for a readable site only.
6. **Rung 3.** Follow the upstream `agentify-website` skill for the network, the manifest and the runtime. Read `references/operable.md` first when the site is a framework app: the bridge, loading, the mount and hosting differ.
7. **Count.** Run `references/page-cost.ts` on a page with the assistant in place. Fix every origin request the agent surface causes (`references/cost.md`).
8. **Rung 4**, only when asked. Follow `references/free-tier.md`.
9. **Guard it.** Write the check script. On Next.js, add `references/check-static-pages.ts` to the end of the build command.
10. **Prove it with a fresh agent.** Give a new agent only the site's public address and one real task. Score what it built by machine. If it needs a hint, fix the document, not the prompt.
11. **Report**: what an agent gets at each rung with real addresses, the call counts before and after, what the assistant declines, the checks and their results, and the limits you know of.

## Worked Example

A component catalog with 154 pages, a Next.js 16 app on Netlify, 21 Nov 2026.

**Before:** the component page was the only way in. Each page view ran 3 functions: the page, a view count, and a 404 for a file a script asked for by convention.

**After**, from `bun references/audit.ts https://motion-garden.netlify.app` (some lines left out):

```
Findable  (4 ok, 0 failed, 0 to look at)
  ok    /llms.txt
        "Motion Garden", 157 links in 8 sections, 36,282 characters
Readable  (3 ok, 0 failed, 0 to look at)
  ok    Markdown twin
        /components/waves.md, 19,482 characters, text/markdown; charset=utf-8, named in <link rel="alternate" type="text/markdown">
Operable  (1 ok, 0 failed, 0 to look at)
  ok    agent manifest
        /agent/agent-manifest.json: network motion_garden, 8 site actions offered as tools
Cost  (3 ok, 0 failed, 1 to look at)
  ok    /components/waves.md is served without your server
        from cache (cache-status: Netlify Edge; hit; ttl=2591831)
  warn  a missing file runs your server
        404, reached the origin (cache-status: Netlify Durable; fwd=bypass).
```

And from `page-cost.ts` on a page this browser had seen: `first view: 0 reached the origin` and `reload: 0 reached the origin`, out of 102 same-origin requests each. A first-ever view costs one call, the view count.

What changed: every agent document became a file built once per deploy, the two file reads on the page moved into cached functions, the view count is sent once per browser, and the missing file became a real one. The audit still warns about missing files in general, which is true: any other unknown address still runs the 404 page.

## Self-Check Before You Deliver

1. `bun references/audit.ts <site>` shows no `FAIL` on the rungs you built.
2. Every `Cost` line for a document says `from cache` on the second run after a deploy.
3. `bun references/page-cost.ts <page>` lists no `ORIGIN` line caused by the agent surface, on the first view and on the reload.
4. The build's route list shows every document route as static.
5. Search the document handlers for `request.`, `headers(`, `cookies(` and `searchParams`: none.
6. `/llms.txt` answers `text/plain`, starts with `# `, and its links answer 200.
7. The page's HTML has a `<link rel="alternate" type="text/markdown">`, and that address answers with text and `Access-Control-Allow-Origin: *`.
8. Search the published bundle for keys, tokens and email addresses: none.
9. Rung 3: a refused action returns `ok: false` with a reason and changes nothing. No action throws on bad input.
10. Rung 4: a request with a changed system message, a foreign tool, a foreign origin or a caller-chosen model is refused or overridden. Each has a test.
11. Your report states the server calls per page view, per chat open and per question, from a run.
12. You told the owner how many live runs you made and what each one added to their numbers.
