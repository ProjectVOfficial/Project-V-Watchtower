# Project V Watchtower — Phase 16.3

## API & Data Sources cleanup

This maintenance patch removes the inherited World Monitor waitlist promotion from the Project V API & Data Sources overview.

Removed from the visible settings interface:

- **Reserve Your Spot**
- Email registration field
- **Join Waitlist**
- The divider and registration-status area

The associated frontend registration handler was also removed, so Project V no longer attempts to call the upstream `/api/register-interest` endpoint from this settings screen.

The existing license-key field and all individual API/data-source configuration categories remain intact. No API keys, saved settings, feature toggles, or desktop credentials are changed by this patch.

## Run

```powershell
npm run desktop:dev
```

No new npm dependency was added.
