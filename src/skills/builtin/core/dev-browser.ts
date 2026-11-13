import type { BuiltinSkill } from "../../loader/types"

export const devBrowserSkill: BuiltinSkill = {
  name: "dev-browser",
  description:
    "Use when automating a browser with persistent page state — navigate websites, fill forms, take screenshots, extract web data, test web apps, or automate browser workflows. Trigger phrases include 'go to [url]', 'click on', 'fill out the form', 'take a screenshot', 'scrape', 'automate', 'test the website', 'log into', or any browser interaction request.",
  template: `# Dev Browser Skill

Browser automation that maintains page state across script executions. Write small, focused scripts to accomplish tasks incrementally. Once you've proven out part of a workflow and there is repeated work to be done, you can write a script to do the repeated work in a single execution.

## Runtime Is NOT Bundled

Matrixx ships this skill as documentation only. The dev-browser runtime (server + client) is not part of Matrixx, and no \`skills/dev-browser/\` directory exists in this repo. Every command below works only **if the runtime is installed at \`./dev-browser-server\`** — a checkout of the upstream project at https://github.com/SawyerHood/dev-browser. If it is not installed, stop and ask the user to install it; do not invent server commands.

## Install (one-time)

\`\`\`bash
git clone https://github.com/SawyerHood/dev-browser ./dev-browser-server
cd ./dev-browser-server && npm install   # or: bun install
\`\`\`

Follow the upstream README for browser and extension setup.

## Choosing Your Approach

- **Local/source-available sites**: Read the source code first to write selectors directly
- **Unknown page layouts**: Use \`getAISnapshot()\` to discover elements and \`selectSnapshotRef()\` to interact with them
- **Visual feedback**: Take screenshots to see what the user sees

## Setup — Start the Server

> Requires the runtime installed at \`./dev-browser-server\`.

Two modes available. Ask the user if unclear which to use.

### Standalone Mode (Default)

Launches a new Chromium browser for fresh automation sessions.

\`\`\`bash
cd ./dev-browser-server && ./server.sh &   # add --headless if the user requests it
\`\`\`

**Wait for the \`Ready\` message before running scripts.**

### Extension Mode

Connects to the user's existing Chrome browser. Use this when:

- The user is already logged into sites and wants you to do things behind an authed experience that isn't local dev.
- The user asks you to use the extension

**Important**: The core flow is still the same. You create named pages inside of their browser.

Start the relay server:

\`\`\`bash
cd ./dev-browser-server && npm install && npm run start-extension &
\`\`\`

Wait for \`Waiting for extension to connect...\` followed by \`Extension connected\` in the console.

If the extension hasn't connected yet, tell the user to launch and activate it. Download link: https://github.com/SawyerHood/dev-browser/releases

## Writing Scripts

> Requires the runtime installed at \`./dev-browser-server\`. Run scripts from that directory so the runtime's own module resolution applies, and import the client from the entry point the upstream README defines.

Execute scripts inline using heredocs:

\`\`\`bash
cd ./dev-browser-server && npx tsx <<'EOF'
import { connect, waitForPageLoad } from "./client" // confirm the entry path in the upstream README

const client = await connect();
const page = await client.page("example", { viewport: { width: 1920, height: 1080 } });

await page.goto("https://example.com");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });
await client.disconnect();
EOF
\`\`\`

### Key Principles

1. **Small scripts**: Each script does ONE thing (navigate, click, fill, check)
2. **Evaluate state**: Log/return state at the end to decide next steps
3. **Descriptive page names**: Use \`"checkout"\`, \`"login"\`, not \`"main"\`
4. **Disconnect to exit**: \`await client.disconnect()\` - pages persist on server
5. **Plain JS in evaluate**: \`page.evaluate()\` runs in browser - no TypeScript syntax

## Workflow Loop

1. **Write a script** to perform one action
2. **Run it** and observe the output
3. **Evaluate** - did it work? What's the current state?
4. **Decide** - is the task complete or do we need another script?
5. **Repeat** until task is done

### No TypeScript in Browser Context

Code passed to \`page.evaluate()\` runs in the browser, which doesn't understand TypeScript:

\`\`\`typescript
// Correct: plain JavaScript
const text = await page.evaluate(() => {
  return document.body.innerText;
});

// Wrong: TypeScript syntax will fail at runtime
const text = await page.evaluate(() => {
  const el: HTMLElement = document.body; // Type annotation breaks in browser!
  return el.innerText;
});
\`\`\`

## Scraping Data

For scraping large datasets, intercept and replay network requests rather than scrolling the DOM.

## Client API

\`\`\`typescript
const client = await connect();

// Get or create named page
const page = await client.page("name");
const pageWithSize = await client.page("name", { viewport: { width: 1920, height: 1080 } });

const pages = await client.list(); // List all page names
await client.close("name"); // Close a page
await client.disconnect(); // Disconnect (pages persist)

// ARIA Snapshot methods
const snapshot = await client.getAISnapshot("name"); // Get accessibility tree
const element = await client.selectSnapshotRef("name", "e5"); // Get element by ref
\`\`\`

## Waiting

\`\`\`typescript
await waitForPageLoad(page); // After navigation
await page.waitForSelector(".results"); // For specific elements
await page.waitForURL("**/success"); // For specific URL
\`\`\`

## Screenshots

\`\`\`typescript
await page.screenshot({ path: "tmp/screenshot.png" });
await page.screenshot({ path: "tmp/full.png", fullPage: true });
\`\`\`

## ARIA Snapshot (Element Discovery)

Use \`getAISnapshot()\` to discover page elements. Returns YAML-formatted accessibility tree:

\`\`\`yaml
- banner:
  - link "Hacker News" [ref=e1]
  - navigation:
    - link "new" [ref=e2]
- main:
  - list:
    - listitem:
      - link "Article Title" [ref=e8]
\`\`\`

**Interacting with refs:**

\`\`\`typescript
const snapshot = await client.getAISnapshot("hackernews");
console.log(snapshot); // Find the ref you need

const element = await client.selectSnapshotRef("hackernews", "e2");
await element.click();
\`\`\`

## Error Recovery

> Requires the runtime installed at \`./dev-browser-server\`.

Page state persists after failures. Debug with:

\`\`\`bash
cd ./dev-browser-server && npx tsx <<'EOF'
import { connect } from "./client"

const client = await connect();
const page = await client.page("hackernews");

await page.screenshot({ path: "tmp/debug.png" });
console.log({
  url: page.url(),
  title: await page.title(),
  bodyText: await page.textContent("body").then((t) => t?.slice(0, 200)),
});

await client.disconnect();
EOF
\`\`\``,
}
