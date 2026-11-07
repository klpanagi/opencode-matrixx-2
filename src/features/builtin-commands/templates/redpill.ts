export const REDPILL_TEMPLATE = `Toggle redpill mode for the current session.

This command will:
1. Enable redpill mode — injects redpill mode instructions into every message
2. Disable redpill mode — prevents redpill mode from activating (even on "redpill" keyword)
3. Show current redpill mode status

Usage:
  /redpill enable — Force redpill mode on all messages
  /redpill disable — Block redpill mode (keyword ignored)
  /redpill status — Show current state

The change is per-session and clears when the session ends.
By default, redpill mode activates when the LLM or user mentions the "redpill" keyword.`
