# Personal Dashboard - Agent Development Guide

## Project Context

Personal Dashboard is the human-facing daily app layered over the headless Personal Vault at `~/personal-vault/`.

Personal Vault is the durable private memory backend. This dashboard is the UI surface for:

- Today brief
- Planner projection
- Vault browsing and search
- Recent changes
- Future mobile/PWA notification flows

## Architecture Rules

1. Treat `~/personal-vault/` as private data, not app source code.
2. Do not commit real vault content into this project.
3. Prefer API/MCP/CLI boundaries over direct filesystem access as the architecture matures.
4. Keep the UI useful while the backend boundary is being extracted.
5. Planner is a module/projection, not a separate source of truth.

## Technology

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- lucide-react icons
- Markdown parsing/rendering for vault content

## Near-Term Direction

1. Keep Today as the default route.
2. Keep Vault browsing/search available for inspection.
3. Build Planner as a generated weekly/today projection from vault context.
4. Extract repeated vault filesystem logic into a Personal Vault API boundary.
5. Add mobile/PWA surfaces only after the Today and Planner contracts are stable.
