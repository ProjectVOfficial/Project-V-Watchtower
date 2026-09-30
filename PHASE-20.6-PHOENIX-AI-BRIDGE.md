# Project V Watchtower — Phase 20.6 Phoenix AI Bridge

This patch adds the Watchtower side of the Phoenix Desktop 0.9.8 authenticated local alert bridge.

## What it does

- Adds **Phoenix AI** to `V → PROJECT V BRIDGE`.
- Pairs using the JSON copied from **Phoenix → Watchtower → Copy receiver pairing**.
- Stores the Phoenix pairing token in Watchtower's desktop operating-system credential store, not localStorage.
- Restricts native delivery to loopback HTTP endpoints using `/api/watchtower/alert` on ports 1024–65535.
- Automatically forwards newly-created Watchtower alerts at **HIGH + CRITICAL** by default.
- Lets the analyst change the automatic threshold from `INFO+` through `CRITICAL` or turn automatic forwarding off.
- Adds a manual **PHOENIX** action to each Alert Center item.
- Adds **SEND TO PHOENIX** to the Air Operations aircraft inspector.
- Phoenix-offline failures never block Watchtower from creating, displaying, acknowledging, resolving, or storing its own alerts.

## Phoenix side

Requires Phoenix Desktop 0.9.8 or later with the Watchtower receiver enabled. Phoenix's default receiver is:

`http://127.0.0.1:17871/api/watchtower/alert`

Phoenix stores received Watchtower alerts in Phoenix Alerts and can use them as grounded Watchtower context in main Chat.

## Pairing

1. Start Phoenix 0.9.8.
2. Open Phoenix → Watchtower.
3. Confirm **Phoenix Watchtower receiver** is enabled.
4. Choose **Copy receiver pairing**.
5. In Watchtower open the V drawer → **PROJECT V BRIDGE**.
6. Under **PHOENIX AI**, choose **PAIR PHOENIX** and paste the copied JSON.
7. Choose **TEST**.
8. Verify the test appears in Phoenix Alerts.

## Security boundary

Watchtower can send only structured alert records to the paired loopback Phoenix receiver. The bridge does not grant Watchtower access to Phoenix system-control tools, files, shell execution, processes, firewall, power controls, or other privileged Phoenix actions.
