# Cafe Elite — Winter Magic 2026

Owner-approved public seasonal theme, integrated with the existing authoritative production menu at render time. The original storefront, all existing product assets, Manager, order and payment APIs remain unchanged. Only the public index receives the seasonal presentation. `CAFE_CHRISTMAS_ENABLED=0` disables it on restart; otherwise production defaults on. No automatic expiry date was assumed. The original preview and its checkpoints are separate and are not deployed.

Audio: First Snow by Scott Buckley, original unedited MP3, released under CC BY 4.0. Source: https://www.scottbuckley.com.au/library/first-snow/ ; terms: https://www.scottbuckley.com.au/library/using-this-music/ ; licence: https://creativecommons.org/licenses/by/4.0/ . Keep the artist and licence links with the seasonal controls. Playback loops at low gain (0.10) with fades. The desired preference is on by default; audible autoplay is subject to browser policy, with trusted-interaction fallback. Turning music off stores the preference locally on that browser. The original track is streamed via a bounded single-range HTTP response, including Safari's byte probes. No third-party music service requests are made.

Seasonal decorative images are the approved V5 generated artwork and owner-approved snowy storefront variant. The generated seasonal view is decorative, not a record of actual weather. Public seasonal resources use an exact allowlist, not a wildcard. Preview/gallery, dev files and private server modules stay private.

Rollback: disable via CAFE_CHRISTMAS_ENABLED=0 or revert this release commit and redeploy. Do not restore old database snapshots or change business settings to roll back a seasonal design.
