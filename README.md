# NEXA — Social × AI × 4D (Prototype)

An interactive single-file frontend prototype of the NEXA app concept:
feed, stories, reels, messages, profile, and a live AI assistant panel
(NEXA AI) wired to the Claude API.

## How to run
Just open `index.html` in any modern browser. No build step, no dependencies.

## Notes
- This is a frontend UI/UX prototype, not a production backend.
- The NEXA AI assistant makes a real API call to Claude when used inside
  Claude.ai's artifact environment; outside that environment (e.g. opened
  as a plain local file), the AI chat network request may not resolve.
- All other interactions (likes, saves, comments, messaging, navigation,
  reels) are fully functional client-side with mock data.
