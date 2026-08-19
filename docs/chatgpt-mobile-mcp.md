# ChatGPT Mobile + Personal Vault MCP

Goal: use ChatGPT mobile as the capture/conversation interface while Personal Vault remains the private memory backend and Personal Dashboard remains the planning UI.

Core capture principle: raw input stays fluid and the processor proposes derived updates later. The authoritative contract lives in the private `personal-vault` repository.

## Architecture

ChatGPT mobile -> ChatGPT connector -> HTTPS MCP endpoint -> Personal Vault files

The compatibility launcher is `mcp/personal-vault-server.mjs`; the authoritative MCP server lives in the private `personal-vault` repository. It exposes:

- `capture_note`: save an approved note, task, decision, workout note, image-backed note, or conversation summary as readable Markdown.
- `capture_note` also creates reviewable proposed actions and returns them to ChatGPT.
- `apply_capture_action`: apply one proposed action after explicit user approval.
- `get_today_plan`: read today's Health and AI commitments from the vault.
- `search_vault`: search readable Markdown files for prior decisions and context.

## Local test

```bash
npm run mcp:vault
```

The endpoint is:

```text
http://localhost:8787/mcp
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http
```

## ChatGPT connection

ChatGPT requires a reachable HTTPS MCP endpoint for a connector.

For local development, expose the MCP server with ngrok:

```bash
ngrok config add-authtoken <token-from-ngrok-dashboard>
ngrok http 8787
```

For a more stable development connector, reserve a static ngrok domain and save it in:

```bash
cp /Users/kirill/personal-vault/.env.ngrok.example /Users/kirill/personal-vault/.env.ngrok
# edit NGROK_DOMAIN=your-static-domain.ngrok-free.app
launchctl bootstrap gui/$(id -u) /Users/kirill/Library/LaunchAgents/com.kirill.personal-vault.ngrok.plist
```

Then create a connector in ChatGPT:

1. ChatGPT web -> Settings -> Apps & Connectors -> Advanced settings.
2. Enable developer mode if available for the account/workspace.
3. Settings -> Connectors -> Create.
4. Connector name: `Personal Vault`.
5. Connector URL: `https://<ngrok-domain>/mcp`.
6. Create, verify the tool list, then open ChatGPT mobile.

Once linked on ChatGPT web, the connector should be available in ChatGPT mobile.

## Production

For a durable deployment, use a small Node host that can access the vault:

- local Mac/home server with the reserved ngrok domain,
- VPS with encrypted vault checkout/sync,
- container service with persistent encrypted volume.

Do not expose this without authentication for anything beyond local/tunnel testing.

## Google Authentication

The MCP server can require Google OAuth bearer tokens before any tool reads or writes private vault data.

Set:

```bash
export MCP_GOOGLE_AUTH=true
export GOOGLE_ALLOWED_EMAILS=kirill.frolov@gmail.com
npm run mcp:vault
```

The server publishes OAuth protected-resource metadata at:

```text
https://<ngrok-domain>/.well-known/oauth-protected-resource
```

`MCP_PUBLIC_BASE_URL` is optional in development. If it is not set, the MCP server infers the public base URL from the incoming request host, which lets the same local process work behind ngrok or another HTTPS tunnel.

Unauthenticated tool calls return an MCP OAuth challenge via:

```text
_meta["mcp/www_authenticate"]
```

For this personal prototype, the server verifies Google access tokens through Google's `userinfo` endpoint and then checks the returned email against `GOOGLE_ALLOWED_EMAILS` or `GOOGLE_ALLOWED_DOMAINS`.

For production, use a first-party authorization server that fully supports the MCP OAuth requirements:

- OAuth authorization-code flow with PKCE,
- protected-resource metadata,
- access-token audience tied to the MCP resource,
- scope verification on every tool call.

## Example prompts

```text
Use Personal Vault and tell me today's plan.
```

```text
Save this to Personal Vault under AI as a task: tomorrow I need to define the mobile MCP capture flow.
```

```text
Search Personal Vault for shoulder rehab decisions.
```

## Image capture

`capture_note` accepts optional image attachments. The server stores them exactly like imported ChatGPT export assets:

```text
raw/YYYY/MM/YYYY-MM-DD-capture-title.md
raw/YYYY/MM/YYYY-MM-DD-capture-title.assets/
  01-image-name.jpg
```

The Markdown file gets relative links such as:

```md
![Breakfast photo](./2026-07-17-capture-breakfast.assets/01-breakfast.jpg)
```

Tool input shape:

```json
{
  "input": "Breakfast photo. Please save and estimate later.",
  "title": "Breakfast photo",
  "projectId": "health",
  "intent": "note",
  "attachments": [
    {
      "name": "breakfast.jpg",
      "mimeType": "image/jpeg",
      "dataBase64": "...base64 bytes...",
      "alt": "Breakfast plate",
      "caption": "Photo captured from mobile"
    }
  ]
}
```

`dataUrl` is also accepted instead of `mimeType` + `dataBase64`, for example `data:image/jpeg;base64,...`.

Supported MIME types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`.

The server appends asset records to:

```text
indexes/capture-assets.jsonl
```

Important limitation: plain ChatGPT MCP tool calls may not automatically receive the original bytes of images uploaded into ChatGPT. If ChatGPT cannot pass `dataBase64`/`dataUrl`, it can still save a text/OCR description, but preserving the original image requires a UI/app upload path, dashboard upload, mobile shortcut, or another client that can send the bytes to `capture_note`.

## Capture routing rules

`capture_note` is intentionally broad and should save first. It may return proposals, but it must not apply them automatically.

Use `apply_capture_action` only after the user explicitly approves a proposal.

Structured dashboard changes use one generic action:

```json
{
  "actionId": "apply-structured-update",
  "projectId": "health",
  "processorId": "health.activity",
  "recordType": "activity_log"
}
```

The public MCP/API contract stays generic. Project-specific parsing belongs behind `processorId`, so adding a new project should mean adding or configuring a processor, not adding a new public endpoint.

Health dashboard proposals should be reserved for factual health/activity records:

- completed exercises,
- weights, sets, reps,
- walking, bike, swim, cardio,
- symptoms, pain, limitations,
- procedures and medical events,
- body measurements and medical decisions.

Keep these as raw capture/inbox or project evidence unless the user asks to promote them:

- MCP, OAuth, connector, and tool discovery discussions,
- Personal Vault architecture decisions,
- dashboard/planner/memory-system ideas,
- general research or product thinking.
