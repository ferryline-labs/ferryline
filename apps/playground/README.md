# @ferryline/playground

The real `<ferryline-widget>` embedded on its own page (playground.ferryline.dev): testnet CCTP,
with a real protocol inspector showing the actual XDR/attestation/relayer calls as they happen.
See `app/page.tsx`, `components/widget-embed.tsx`, and `components/inspector-panel.tsx`.

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values before a real launch. Both are
optional — see `.env.example`'s own comments for the full reasoning (why they're
`NEXT_PUBLIC_`-prefixed, and what running with neither set actually looks like: the widget stays
fully functional, delivery just isn't automatic).

| Variable                                | Required | Notes                                                                                                                                                                                                                                                                   |
| --------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FERRYLINE_RELAYER_URL`     | No       | A real, self-hosted `packages/relayer` instance's base URL.                                                                                                                                                                                                             |
| `NEXT_PUBLIC_FERRYLINE_RELAYER_API_KEY` | No       | **Must be a dedicated, low-privilege, easily-revocable key for this deployment specifically — never a production integrator's key.** This value ships to every visitor's browser by construction (see `.env.example`); treat it as public the moment this page deploys. |

## Development

```bash
pnpm --filter @ferryline/playground dev
```
