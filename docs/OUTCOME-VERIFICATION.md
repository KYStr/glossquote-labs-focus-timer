# U07 opt-in local chime — source candidate

Task: U07-OPT-IN-CHIME-20261013. Date: 2026-10-13. This source upgrade awaits primary review, live deployment, and a new external review; the older live release does not certify it.

## Behavior

- Sound is off initially, with no context creation or playback. The checkbox and Test sound are explicit user gestures; testing does not select the checkbox.
- The local sine tone is 660 Hz, 0.6 seconds, with peak gain 0.04 and a fade to zero. There are no audio downloads, package dependencies, notification permissions, saved preferences, or changes to device volume.
- Only an actual running-to-completed transition attempts one chime. Duplicate callbacks, cancellation, pause, clock errors, pagehide, and late resume results cannot start an old alert. A new Start begins a new session.
- Nodes are mutually exclusive and released after preview. A single context is retained only for an enabled running session; idle preview/probing, completion, pause/cancel/off/pagehide close it. A 650 ms node watchdog and 2000 ms resume limit prevent retained timers. Failed close blocks further allocation instead of creating more contexts.
- Unsupported audio, rejected resume, timeout, and cleanup problems have localized status while the visual timer remains usable. “Attempted” does not claim the sound was heard. Mute, background throttling, sleep, and browser policy may delay or silence it.
- Both production language pages have one x-default pointing to the Chinese root page. Preview remains noindex with relative alternates and no production origin. This is a shared SEO specification update, not an assertion of an indexing defect.

## Automated verification

Node 24.14.0, no package installation:

| Command | Result |
|---|---|
| `npm.cmd test` | exit 0, 78/78; includes 19 new chime/resource/race tests and retained timer, scheduler, boundaries, i18n and release gates |
| `npm.cmd run check` | exit 0, 10 public assets / 14 Node sources |
| `npm.cmd run build` | exit 0, 10 preview assets |
| `node scripts/build.mjs --production --cloudflare --site-url https://focus.glossquote.com/` | exit 0, 14 production files |
| `node scripts/check.mjs --production --cloudflare --site-url https://focus.glossquote.com/` | exit 0, 14 production files; exact metadata, bytes, CSP and release policy |

The checker permits AudioContext identifiers only in `js/chime.mjs`; network, storage, HTML audio, notification and other restrictions remain. Regression checks reject AudioContext in another module and fetch even in the chime module. The original timer/format/scheduler source is unchanged.

## Actual Chrome verification

Actual connected Chrome, local preview: off initially; explicit keyboard preview without selecting the option; keyboard opt-in; one-minute start/pause/resume/cancel and a fresh full minute. Completion showed 00:00, Start again, and one attempted-sound status; starting again began a new minute. Chinese/English navigation reset timer and sound option. Invalid Chinese 181 and English literal 1e2 disabled Start, valid 180 restored 180:00. Both languages at a 320 CSS px viewport showed matching client/scroll widths of 305 after navigation; a first immediate Chinese resize observation differed and is retained in the private evidence rather than hidden. Viewport was reset.

DOM/AX observations are actual interactions. Audio adapter tests use fake contexts and clocks. Neither is an ear/hearing test. Screenshot captures illustrate layout; their render timing can differ from the precise DOM readback. A full-page Chrome screenshot timed out; viewport captures succeeded.

## Remaining NOT_RUN and release boundary

Actual hearing, physical loudness, OS mute, real sleep/background timing, confirmed BFCache hit, screen reader, true 200% zoom/reduced-motion and physical mobile devices remain NOT_RUN. Full Network/Storage/HAR is not certified by source review or an empty console. No hosting, DNS or account settings were changed by this feature owner. After primary release, review this exact new source version externally.
