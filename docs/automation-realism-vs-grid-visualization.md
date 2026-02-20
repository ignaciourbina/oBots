# Automation Realism vs Grid Visualization

## What is real

Bots are controlling real Chromium browser sessions through Puppeteer.

- They click buttons, fill fields, wait for selectors, and submit forms in the oTree UI.
- This is browser-level interaction, so behavior is aligned with how real participants interact with pages.

## What is currently simulated

The Electron grid is currently a visual stream of screenshots, not live embedded browser tabs.

- Bot browsers run headless.
- The app periodically captures screenshots and updates each bot card image.

## Practical implication

- **Behavior realism**: high (real browser automation).
- **Display realism**: medium (frame-based snapshots instead of truly live webviews).

## If full live display is needed

To make the visualization fully live, switch to headed browser instances and/or embed true live webviews per bot tile instead of screenshot refreshes.
