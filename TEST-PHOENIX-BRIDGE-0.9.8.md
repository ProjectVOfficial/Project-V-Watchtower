# Watchtower → Phoenix 0.9.8 Test

## Build gate

```powershell
cd "D:\PROJECTS\Project-V-Watchtower"
npm run typecheck
```

Stop if TypeScript fails.

Then run the desktop development build or your normal Windows build:

```powershell
npm run desktop:dev
```

## Pairing test

1. Start Phoenix 0.9.8 and confirm its Watchtower receiver is listening.
2. Phoenix → Watchtower → **Copy receiver pairing**.
3. Watchtower → **ALERT RULES** → **PHOENIX BRIDGE** → **PAIR PHOENIX**.
4. Paste the JSON.
5. Click **SEND TEST**.
6. Confirm Phoenix receives exactly one Watchtower test alert.

## Real alert test

Create or trigger one Watchtower operational alert. Confirm:

- Watchtower Alert Center still receives it.
- Phoenix receives the same new alert automatically.
- Refreshing Watchtower's Alert Center does not create another Phoenix copy.

## Offline retry

1. Stop Phoenix.
2. Trigger one Watchtower alert.
3. Confirm Watchtower still records the alert and shows a queued Phoenix delivery.
4. Restart Phoenix.
5. Keep Watchtower open for up to 15 seconds.
6. Confirm the queued alert arrives once.
