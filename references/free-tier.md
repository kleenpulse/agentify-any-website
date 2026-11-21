# Rung 4: a free tier the site pays for

By default the assistant runs on the visitor's own AI key, in their browser, and the site pays nothing. Most visitors have no key. A free tier gives each visitor a few questions a day on the site's key.

That key now sits behind a public address. Anyone can send that address anything. This file is the list of things that kept it safe on one live site (built and measured 21 Nov 2026, Next.js 16 on Netlify, OpenRouter as the provider). Build it only when the owner asks, and only after the owner has set the daily limits.

## The shape

- One endpoint that speaks the same protocol as an AI provider: `POST /api/agent/llm/chat/completions`.
- When the site offers the free tier and the visitor has no key, the page hands the runtime that endpoint as its router. The runtime calls it like any provider. **The runtime copy is not changed.**
- A visitor who brings a key never reaches the endpoint. Their browser calls their provider directly.
- The free tier is on only when the key and the counter's table both exist. A fork or a local checkout without them works as before: it asks for the visitor's key.

## Narrow every request before you pay for it

In this order. Each refusal is one plain sentence, because the runtime shows the visitor the first 300 characters of an error body.

| # | Check | Why |
| --- | --- | --- |
| 1 | The key is set, or answer 503 | A deploy without it must fail soft |
| 2 | The request comes from the site's own pages: its `Origin` host is the host it reached, and `Sec-Fetch-Site` is `same-origin` when present | Another site cannot use the key from its own pages |
| 3 | The declared size and the real size are under a limit, checked before parsing | A huge body is refused unread |
| 4 | It is a chat request: a list of messages with known roles, under a count limit, ending in the visitor's message or a tool result | The runtime never asks for a completion after the model's own turn |
| 5 | **The system message is exactly one of this site's agents**: the network file's instructions with their placeholders filled, then the runtime's own context. It is the first message, the only system message, and a plain string | Text added before or after it is someone else's prompt. A list of content parts could carry an extra part past a check that reads only text |
| 6 | Every tool in the request is one of the site's own: its agents, its site actions, the runtime's own tool | No foreign tool definitions on the site's key |
| 7 | **The server picks the model and caps the output.** The caller's model and every other option are dropped | The caller cannot choose what the site pays for |
| 8 | Count the call, then check the limits (below) | No call runs free |
| 9 | Errors from the provider stay on the server. The visitor gets the site's own sentence | A provider's error text can name the account |

Compare system messages with whitespace collapsed, so a line ending cannot break the match.

## Free models only, or a hard cap at the provider

The live site runs free models only: the provider's free router by default, or a configured model when its id is marked free. A paid id in the setting is ignored. So the key cannot be billed through this endpoint, whatever is configured.

If the owner wants a paid model, the daily limits below bound the spend, and the key should also carry a spending limit at the provider. We did not build or measure a paid tier.

## Counting

Limits on the live site, per UTC day: 2 questions a visitor, 300 questions across the site, 4,000 model calls across the site.

1. **A question is not one model call.** Each tool round trip is a call, and a helper agent makes its own. *Measured:* a normal question took 3 to 8 calls. Count questions and calls apart.
2. **A new question** is a request for the front agent that ends in the visitor's message. Every other call (a tool round trip, the helper) runs only against a question already counted: a visitor's calls for the day may never pass their counted questions times a step limit (16). So no call runs before a question is spent, and none outruns the questions spent.
3. **Count in one statement** (an insert that updates on conflict and returns the new row), for the visitor's row and the site-wide row together. Two requests at once cannot both slip under the limit.
4. **Take the count back** when the call is refused at a limit, when the provider cannot be reached, or when the model never answers.
5. **Say which limit was hit**: the visitor's, the site's, or the steps of one question. Each has its own sentence, with what to do next (connect your own model).

## Who is a visitor

- Count by a hash of the day, the visitor's address and a server secret. No address is stored, and a hash cannot be linked from one day to the next. Delete rows older than a week.
- Cut an IPv6 address to its /64: one visitor usually holds a whole /64 and can pick any address in it. Treat an IPv4 address written as IPv6 (`::ffff:203.0.113.7`) as IPv4.
- **Take the address from a header the host sets itself.** *Measured* on Netlify: `x-nf-client-connection-ip` could not be forged from outside. The first `X-Forwarded-For` entry is the client's own word on a host that does not overwrite it; there the per-visitor limit can be dodged and only the site-wide limits hold. Find your host's own header and test it by sending a forged one.
- People behind one address share one count. Say so in the docs.

## The runtime's context, kept in step

Check 5 needs the exact text the runtime appends to each agent's instructions. Do not retype it. A script reads it out of the runtime copy into a JSON file, and a check fails when the two differ. After the runtime is updated, run the script. Until then the endpoint refuses every request, which is the safe way to fail.

## Function calls

| When | Function calls |
| --- | --- |
| A page view, chat never opened | none |
| The chat is first shown | one, for the count |
| A question | the model calls only |
| A question refused at a limit | one more, to correct the count on screen |
| A visitor with their own key, or one whose questions are used today | none |

How:

- The page states the terms (questions a day, the model's name) when it is rendered. No request for them.
- After an answered question the panel lowers its own count. It does not ask again.
- A browser whose questions ran out notes the day in `localStorage`. Its next page loads start on the "connect your own model" view with no request.

## What the visitor sees

- The count, before they ask: "Free questions left today: 1 of 2".
- Where their messages go on the free tier (through the site to a named model), before the first message.
- At a limit, a message labelled as a limit. The runtime shows any refusal as a model error; relabel it, since the model did not fail.
- A visitor's own provider error keeps its status code.

## What this does not stop

A caller can type anything in the user message, as a visitor can in the chat, and a model may follow it. The system message bounds what the model is told to be. The daily limits bound how much anyone gets. Free models only means the key is never billed. Say this in the site's own docs.

## Traps

- **The count route was built once for everyone.** *Measured* on Next.js 16 with Cache Components: a `GET` handler that returned early when no key was set touched nothing from the request at build time, so the build wrote one answer as a static file. Call `await connection()` first, and read the build's route list: this route must be a function.
- **Your own test spends a real question.** A test from the owner's network shares the owner's count. One verification question on the live site made the owner's own test fail at the limit, and it was reported as a bug. Test the chat with the endpoint faked in the page, or take the question back in the database and say so.
- **A long streamed answer can be cut by the host** (near 35 seconds on a Netlify function, *measured*).
