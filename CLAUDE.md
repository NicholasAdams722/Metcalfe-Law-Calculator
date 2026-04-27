# CLAUDE.md — Metcalfe Calculator

## What This Is
A standalone Ethereum valuation calculator built on Metcalfe's Law.
Single-page Vite + React + TypeScript app. Deploys to Vercel as a static site.

## The Formula
V = k × n²
ETH Price = V ÷ circulating supply (117.77M ETH)

- n = Daily Active EOA Addresses (human wallets, bots excluded)
- k = $565 (calibrated to April 2026 market data, CFA Institute methodology)
- Same formula used by Grayscale (ETHE) and Fidelity (FETH) analysts

## Brand Tokens
- Background: #000000 (pure black)
- Surface: #0A0A0A
- Border: #1C1C1C
- Blue accent: #3B6EE8
- Blue light: #6B9BF5
- Blue dark: #1E3A8A
- Text primary: #FFFFFF
- Text secondary: #888888
- Text muted: #444444

## Fonts (Google Fonts)
- Display/headlines: Syne 800
- Body: DM Sans 400/500
- Data/mono: DM Mono 400

## Calculator Features
- DAA slider: 500K → 5M, step 50K
- k toggle: Bear ($425) / Base ($565) / Bull ($750)
- Live outputs: ETH price, network value, % change from baseline, n²
- Scenario table: 5 preset rows (Today, 90d, 180d, Year-End, Bessent)
- Copy-to-share button: generates tweet-ready text with compliance disclaimer

## Compliance (must appear on every output)
"Mathematical projection from Metcalfe's Law. Not investment advice.
Patriot Advisory Group LLC dba Quantum Capital · NH-registered RIA"

## Do Not
- Add routing or multiple pages
- Use heavy animation libraries
- Add auth or backend
- Use light backgrounds