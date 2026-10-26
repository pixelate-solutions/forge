# Forge Agent

Forge Agent is a local always-on AI software factory foundation. It accepts a scope of work, creates a run, parses the scope into structured tickets, writes architecture documents, tracks worker decisions, logs commands, captures visual QA artifacts, and gates risky actions through explicit approvals.

The MVP runs locally on macOS with a Next.js dashboard at `http://localhost:3099`, a Node worker process, SQLite local state, Playwright visual QA, and a central policy engine.

## What It Does

- Paste a SOW or task list into the dashboard.
- Attach images, documents, URL references, and reference notes to a run.
- Create a local run backed by SQLite.
- Parse the SOW into features, tickets, acceptance criteria, dependencies, priorities, tests, and visual QA requirements.
- Use uploaded text references, reference notes, URL context, and opt-in web search as planning context.
- Generate `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, and `DATA_MODEL.md`.
- Run safe local project commands when a target repo has scripts.
- Log actions, commands, worker decisions, artifacts, approvals, and visual QA results.
- Block dangerous commands and require approval for deployment, billing, production, secret, external messaging, DNS, paid, and destructive actions.
- Prepare PR and preview deployment information without pushing to main or deploying production.

## Install

```bash
pnpm install
```

Copy the environment template if you need tokens. Keep token values in environment variables only.

```bash
cp .env.example .env.local
```

Useful variables:

```bash
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GITHUB_TOKEN=
VERCEL_TOKEN=
FORGE_WORKSPACE_ROOT=~/ForgeWorkspaces
FORGE_DATABASE_PATH=./forge-agent.sqlite
```

Forge Agent stores secret references such as `GITHUB_TOKEN`, not raw secret values.

## Run

Start the dashboard and worker together:

```bash
pnpm dev
```

Or run them separately:

```bash
pnpm dashboard
pnpm worker
```

Open:

```txt
http://localhost:3099
```

## First Run

1. Open the dashboard.
2. Paste `examples/sample-sow/lmt-mini-sow.md` into the New Run form.
3. Optionally attach screenshots, PDFs, Markdown, text, JSON, CSV, or other reference files.
4. Optionally add URL references and reference notes.
5. Enable web search only when you want Forge Agent to fetch URL context and search for extra public context.
6. Enter a local repo path or leave it blank to use this workspace.
7. Create the run.
8. Keep `pnpm worker` running. The worker will parse the scope, collect reference context, create tickets, generate architecture docs, run safe local checks when available, and write a final report.

## Scripts

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm visual-qa
pnpm worker
pnpm dashboard
```

Run visual QA against the dashboard:

```bash
FORGE_VISUAL_QA_BASE_URL=http://localhost:3099 FORGE_VISUAL_QA_ROUTES=/ pnpm visual-qa
```

Artifacts are saved under:

```txt
artifacts/runs/{runId}/screenshots
artifacts/runs/{runId}/reports
```

## Approvals

The `PolicyEngine` classifies every command/action as:

- `safe_local`
- `needs_approval`
- `blocked`

Safe local actions include local branches, worktrees, code edits, dependency installation, local tests, local builds, Playwright, screenshots, commits, and local reports.

Needs approval:

- Preview deploys
- Production deploys
- Paid resources
- Billing changes
- Database migrations not clearly local
- Destructive actions
- Secret changes
- External customer messages
- DNS changes

Always blocked:

- `rm -rf /`
- `rm -rf ~`
- `sudo`
- `chmod -R 777 /`
- `curl ... | bash`
- `wget ... | bash`
- `vercel --prod` without approval
- destructive cloud commands
- `terraform destroy`
- `drop database`
- direct pushes to `main` or `master`
- PR merges

The dashboard shows pending approvals with Approve and Reject buttons. The worker pauses the gated action until a human resolves the request.

## References and Web Search

The New Run form accepts:

- Uploaded images and documents
- URL references
- Free-form reference notes
- A per-run web search toggle

Text-like uploads such as Markdown, text, JSON, CSV, HTML, CSS, JavaScript, and TypeScript are read into the worker’s planning context. Images and binary documents are stored as references for manual and future multimodal review.

URL fetching and web search are opt-in per run. When enabled, Forge Agent calls the `PolicyEngine` before external research, fetches user-provided URLs, and queries DuckDuckGo’s public instant answer endpoint for additional context. It does not send secrets intentionally, and command/log storage still redacts known secret patterns.

## Visual QA

The visual QA runner opens Chromium with Playwright and checks:

- `mobile-small` 390x844
- `mobile-large` 430x932
- `tablet` 768x1024
- `laptop` 1366x768
- `desktop` 1440x900
- `wide` 1920x1080

For each route it captures screenshots, console errors, failed network requests, horizontal overflow, broken images, missing image alt text, and unusable hidden controls.

The placeholder `screenshotReviewer.ts` interface is ready for later OpenAI or Claude multimodal screenshot inspection.

## GitHub

Set `GITHUB_TOKEN` in your shell or launchd environment. The MVP prepares PR titles and bodies locally. It does not push branches, push to main, or merge PRs automatically.

## Vercel

Set `VERCEL_TOKEN` in your shell or launchd environment. Preview deployments are approval-gated. Production deployments are never executed silently.

To request a preview approval from the worker:

```bash
FORGE_PREPARE_VERCEL_PREVIEW=1 pnpm worker
```

## macOS launchd

A sample plist is available at:

```txt
docs/launchd/com.forge-agent.worker.plist
```

Edit every `/ABSOLUTE/PATH/TO/...` placeholder, then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.forge-agent.worker.plist
```

Unload it:

```bash
launchctl unload ~/Library/LaunchAgents/com.forge-agent.worker.plist
```

## Current Limitations

- Scope parsing is deterministic and local in this MVP; model-provider execution is intentionally not wired by default.
- The builder does not yet autonomously implement arbitrary feature code in target repos.
- GitHub PR creation and Vercel execution are prepared but approval-gated and not auto-run.
- Visual AI screenshot judgment is a placeholder interface; Playwright checks and reference file storage are real.
- PDFs and office documents are stored as references, but text extraction is currently limited to text-like files.
- The dashboard settings page displays settings but only the API supports saving settings today.

## Roadmap

- Add model-backed agents with provider selection and token budgeting.
- Add a richer builder loop that edits target repos ticket by ticket.
- Add GitHub PR creation after explicit approval.
- Add Vercel preview execution after explicit approval.
- Add Playwright trace/video retention on failures.
- Add manual screenshot review notes in the dashboard.
- Add project templates for common app stacks.
