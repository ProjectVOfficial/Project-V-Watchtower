# Project V Watchtower → Phoenix 0.9.8 Alert Bridge

This patch connects Watchtower's existing operational Alert Center to the authenticated loopback receiver introduced in Phoenix Desktop 0.9.8.

## Pairing

1. In Phoenix open **Watchtower**.
2. Click **Copy receiver pairing**.
3. In Watchtower open **ALERT RULES**.
4. Under **PHOENIX BRIDGE**, click **PAIR PHOENIX**.
5. Paste the JSON copied from Phoenix.
6. Click **SEND TEST**.

The pairing token is stored in Watchtower's existing OS-backed secret vault under `PHOENIX_WATCHTOWER_TOKEN`. It is not saved in browser localStorage.

## Alert flow

Every newly-created `OperationalAlert` passes through Watchtower's single `ProjectVOperationsCenter.addAlert()` path. The bridge sends only at that creation point:

`Watchtower alert → authenticated localhost POST → Phoenix Alerts → Windows notification / optional voice / Chat context`

Rendering or refreshing Alert Center does not resend an alert.

## Offline behavior

Phoenix is optional. If Phoenix is offline, Watchtower still saves and displays its own alert normally. Delivery is queued locally and retried while Watchtower remains open. Pending records survive a Watchtower restart for up to 24 hours. Phoenix keeps its own persistent alert-ID dedupe, so a successful retry does not create duplicates.

## Security

- Sender accepts only loopback `http://127.0.0.1`, `localhost`, or `::1` endpoints.
- Required path is `/api/watchtower/alert`.
- Pairing token is stored in the Watchtower secret vault.
- Tauri/Rust sends the HTTP request so remote web content does not receive the token.
- The bridge sends alert records only. It does not grant Watchtower Phoenix command execution access.
