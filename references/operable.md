# Rung 3: operable, on a real app

At this rung the site's own functions become tools. An assistant on the page can search, open things and change what the visitor sees, and other agent sites can call the site's public reads.

**Build the network with the upstream skill.** The agent network, the browser runtime, the manifest, the bridge for other sites and the build script come from the `agentify-website` skill in [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web) (Apache 2.0), which implements the Worldwide Agentic Web spec. Read it and follow it. It is not copied here.

That skill is written for a static site: a folder of HTML and scripts that you copy and whose page script you turn into a module. This file is what changes when the site is a framework app (React, Next.js, Vue, Svelte) on a host that bills by the function call. All of it was built and measured on one Next.js 16 app on Netlify on 21 Nov 2026, with the runtime copy the upstream skill shipped that week.

## 1. Where the bundle lives

Put the whole bundle in the app's public folder, for example `public/agent/`: the network file, the manifest, `site.js`, the actions module, the runtime copy. The framework serves it as plain files and never bundles it.

- Add `public/agent/package.json` with `{ "type": "module" }`. Node tools and tests then read the `.js` files as ES modules without touching the app's own settings.
- Do not edit the runtime copy. Keep its license file beside it.
- The upstream skill copies the site to a new folder. For an app, add the bundle in place and leave the app as it is.

## 2. The bridge between the app and the actions

The actions module is a plain file outside the app's bundle. It cannot import a component's state. So the app publishes its operations on one global object, and the actions module only wraps them.

In the app:

```ts
// lib/agent/bridge.ts
export interface WorkspaceHandle {
	slug: string;
	getValues: () => Values;
	setMany: (patch: Values) => void; // the same setter the page's own controls call
	reset: () => void;
}

let current: WorkspaceHandle | null = null;

/** The component that owns the state calls this when it mounts. */
export function registerWorkspace(handle: WorkspaceHandle): () => void {
	current = handle;
	return () => {
		if (current === handle) current = null;
	};
}

window.__mySite = { getState, setControls, openItem, resetControls };
```

In the public folder:

```js
// public/agent/site-actions.js
const NOT_READY = { ok: false, reason: "The page is still loading. Ask the visitor to wait a moment, then try again.", field: "page" };
const site = () => (typeof window !== "undefined" ? window.__mySite : undefined);

execute: (args) => site()?.setControls(args) ?? NOT_READY,
```

Rules:

1. **State stays where it lives** (the URL, a store). The bridge forwards to the component that is mounted now. It keeps no copy.
2. **An action calls the same function the page's own button calls.** No business rule lives in the actions module.
3. **Check that the mounted component belongs to the page in the address bar.** During a navigation the old one can still be registered.
4. **Navigate with the app's router**, then wait for the new page's component to register (with a time limit) before you answer. Return the new state, so the model does not have to ask again.
5. **Return plain data**: `JSON.parse(JSON.stringify(value))`. A live object can carry functions and cycles.
6. **Answer `NOT_READY` while the app loads.** The runtime can boot before the page has mounted.

## 3. Refuse with data, never by throwing

The runtime reports a thrown error to the model as "unknown outcome", and the model then tells the visitor it is not sure what happened. So an operation refuses by returning, before it changes anything:

```json
{ "ok": false, "reason": "speed must be between 0.1 and 4.", "field": "speed" }
```

- **Check every value against the schema the page's own controls use**: the range, the options, the type. One table, used twice.
- **All or none.** One bad value in a batch refuses the batch.
- **Be forgiving where it is safe**: match an option without regard to case and return the real spelling; accept `#abc` and return `#aabbcc`.
- **Refuse empty and duplicate batches, and input of the wrong shape**, with a reason. Never throw on input.

## 4. Tool descriptions

The description is all the model knows about a tool. Each one says:

- what it does, and "Changes nothing." for a read;
- when to call it: "Call it only when the visitor asks to change how the open component looks or moves.";
- what to do first: "In the same turn, read the page state first for the control names and ranges.";
- what comes back.

A state read also says: "Call it again in each turn that needs current values: the visitor can also move the controls by hand."

Put hard limits in the input schema: `maxLength`, `maxItems`, `minimum`, `additionalProperties: false`.

Mark effects as the upstream skill says: `read`, `write` (the visitor can undo it on the page) or `irreversible` (the visitor confirms in a dialog). When unsure, `irreversible`.

## 5. Keep long text out of the chat

The runtime caps a tool result (64 KB in the copy we used), and the visitor's model pays for every character.

- Set a limit for one result. We used 30,000 characters. A longer document is left out, and the result lists its files, the install command and the address of the Markdown twin, with a field that says so (`briefIncluded: false`) and a reason. *Measured:* 40 of 163 documents were over the limit.
- Offer a second tool that reads one file, one part at a time.
- **Give the long read to a helper agent.** A second agent reads the full document and returns only what the visitor needs. The front agent's context then stays small on every other turn. The helper cannot see the chat, so the front agent passes what the visitor said about their project.
- A component's documents do not change while the page is open. Fetch each once per page and keep it in a map. Do not keep a refusal or a failure.

## 6. Loading without slowing the page

*Measured:* a cold start of the runtime was about 35 small requests in a chain, roughly 130 KB, and about seven seconds on a slow connection when it started at the click.

1. **Load `site.js` by address**, with a `<script type="module">` added at run time. None of it is in a page's own JavaScript.
2. **Start it in the background** once the page has loaded and the browser is idle (`requestIdleCallback` with a timeout; a short timer where that is missing). The chat is ready when the visitor opens it.
3. **Skip the background start** when the visitor asked to save data (`navigator.connection.saveData`) or is on 2G. There it loads on first open.
4. **Preload the modules the chain reaches late** (`<link rel="modulepreload">`): the runtime's entry and the actions module.
5. **The page works when the assistant fails to load.** Show a plain message in the panel and nothing else changes.

## 7. One mount that moves

In an app with client-side navigation, the assistant must survive a page change. The runtime keeps references to the elements it builds.

- Create the mount element once, outside the framework's render tree.
- Let each host (a drawer on every page, a full page) attach it on mount and release it on unmount. Move the same element; never build a second.
- When the visitor leaves the full page with a conversation in progress, open the drawer, so the chat follows them.

## 8. A page view costs no function call

Count before you ship (`page-cost.ts`). What we found, and the fix for each:

| What ran a function on every page view | Fix |
| --- | --- |
| Asking the server "is there a free tier, and how many questions are left?" during the background start | The page states the free tier's terms itself when it is rendered. The count is asked for once, when the visitor first sees the chat. |
| The runtime asked the site's origin for `/agent-manifest.json`, to check the router it was given. No such file: the app's 404 answered. | A small pointer file at the site root that names the real manifest. |
| Every document the assistant reads | Static files (see `readable.md`, section 5). Only search runs on the server. |

The second one was not in any code we wrote. Only a browser count showed it.

## 9. Hosting

- The public bundle files need `Access-Control-Allow-Origin: *`: the manifest, the network file, the link map, the discovery files.
- The runtime's sandbox worker needs its own Content-Security-Policy that gives it no network.
- The bridge page must not send `X-Frame-Options` or `frame-ancestors`. Other sites load it in a hidden frame.
- Set these twice when the CDN serves the public folder without running the framework (see `readable.md`, section 6).

## 10. What other sites get

Share only reads of public facts through the bridge (`callerOrigins: ["*"]`). Actions that read or change this visitor's page stay on the site's own page. Write the shared reads once and register them in both places.

## 11. Small rules for the chat

- **A starter prompt fills the input. It never sends.** The visitor may want to edit it, and on a free tier a sent message spends a question.
- **Say where messages go before the first message**: to the visitor's own AI provider on their key, or through the site to a named model.
- **The instructions list what the site cannot do**, and the sample queries include one the assistant must decline.
- **Tell a limit from a failure.** When the site refuses a question at its daily limit, label the message as a limit, not as a model error.

## 12. Checks worth writing

Run them in CI, against the real data, with no browser:

- Every value kind is accepted in range and refused out of range, with the reason.
- One bad change refuses the whole batch. Wrong-shaped input is refused, never thrown.
- Every default in the catalog passes through the validator unchanged.
- The network's "cannot do" rules match what the site can do.
- The manifest, the network file and the sample queries agree.
- The background start makes no request to a function route.
- The site root answers the runtime's manifest check with a file.

The upstream skill's Node tests drive a static page script, so they do not fit a framework app. Test the action logic directly, and drive the real actions once in a browser through the runtime's action registry.

## 13. Limits we hit

- **A streamed answer was cut near 35 seconds** on a Netlify function. Five shorter calls ended cleanly. Long code answers on slow models are at risk. An edge function is the likely fix; we did not build it.
- **Writes run without a dialog.** The spec asks to show writes first. We accepted it only because every write there changes what is on screen and the visitor can undo it.
- **Every agent sees every site tool.** Instructions scope them.
- **The visitor's AI provider must allow browser requests** (CORS).
