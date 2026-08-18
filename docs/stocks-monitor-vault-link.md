# Stocks Monitor in Personal Vault

The Wealth project shows a compact, read-only daily research shortlist from Stocks Monitor. It uses the existing local SSH tunnel at `http://127.0.0.1:3320` and requests only the monitor's live shortlist projection.

The projection is limited to ten sourced candidates from ASX, US, Hong Kong, London, Estonia and Norway with an ex-distribution date from T+2 through T+9. This is a two-day review buffer plus one week ahead of the ex-date. It ranks research readiness and data completeness; it is not a buy list, trading instruction, or financial recommendation. Its explanation is deterministic and sourced from the monitor's current fields. P/E, analyst consensus, or third-party ratings are shown only if a permitted adapter supplies them with a source URL and retrieval time.

The panel is a navigation and current-status surface, not a second store of market data:

- Raw provider responses remain in Stocks Monitor source-snapshot storage.
- Normalised records and observation history remain in Stocks Monitor runtime storage.
- Personal Vault does not receive provider credentials, broker access, order controls, or a copied market-data database. It displays the current shortlist response only.
- If the tunnel is unavailable, the panel reports that condition rather than substituting a stale Vault copy.

The monitor itself remains research-only: it supplies sourced candidates for manual review and does not issue recommendations or connect to brokers.
