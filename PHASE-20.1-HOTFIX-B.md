# Phase 20.1 Hotfix B — Restore Edit Deck

This hotfix restores the **EDIT DECK** control as a fixed operations-bar control.

## Problem
The edit control was still treated as an optional Quick Bar command. If the saved Quick Bar configuration did not include `edit-deck`, the button was hidden, removing the obvious way to enter panel move/resize mode.

## Fix
- Moves **EDIT DECK** directly beside **LAYOUT**.
- Removes it from the hideable Quick Bar command set.
- Keeps the existing edit-mode behavior and localStorage state.
- The button still changes to **LOCK DECK** while editing is active.

No panel layout data is reset by this patch.
