# The Mist Bird

The hero mascot for Mistbox email. A hummingbird — small, fast, carries
something precious a long way, and native to the Pacific Northwest the boxes
come from.

Everything here is generated. The bird is **geometry, not a picture**: it lives
in `tools/lib/bird.mjs` and every rendering builds from that one source, so the
poses cannot drift away from the mark.

```
node tools/bird-poses.mjs        # the seven poses          → poses/
node tools/bird-proportions.mjs  # the anatomy study        → proportions.png
node tools/bird-compare.mjs      # the three bills, level   → bill-comparison.png
```

## Decided

**Treatment: gold contour.** `#C6A462` line, bone fill, one forest eye. Chosen
over Ink & gold and the Foil silhouette (`1-ink-and-gold.png`,
`2-foil-silhouette.png`, `3-gold-contour.png`).

The trade-off was made with eyes open: **gold on bone measures 1.96:1**, so the
contour ghosts below roughly 180px. That is fine for a hero, which is where it
lives. For the favicon, the avatar and the sender chip, use the **Foil
silhouette** instead — same bird, filled forest and edged gold, still legible at
32px. One mark, a display cut and a text cut.

**Anatomy: the corrected bill.** `DEFAULT_BILL` in `tools/lib/bird.mjs`.

The original artboard's bill was 29% of the bird's total length; a real
hummingbird's is 17–22% (Ruby-throated and Anna's: length 7–11 cm, wingspan
8–12 cm, bill 15–20 mm). Because the bill padded the total, every other share
was dragged out of range with it — which is why the wing appeared short at
1.05× span-to-length when the wing was never the problem.

| Measure | Real bird | Artboard | Adopted |
|---|---|---|---|
| Bill ÷ total length | 17–22% | 29% | **22%** |
| Head + body ÷ total | 48–55% | 45% | **50%** |
| Tail ÷ total | 25–30% | 26% | **28%** |
| Wingspan ÷ total length | 1.15–1.22× | 1.05× | **1.16×** |

One measurement, four fixes. `bird-proportions.mjs` re-checks these against the
ranges on every run, so a future change to the anatomy fails loudly.

The **head stays deliberately oversized** — about a third of head-plus-body
where a real bird is nearer a quarter. That exaggeration is what keeps the mark
reading as a character rather than as a wader. Kept knowingly, not missed.

## The seven poses

Each is the same geometry under two levers — a body tilt and a wing rotation
about the shoulder — plus whatever the bird is carrying. Positive tilt is
nose-up (the bird faces left).

| Pose | For |
|---|---|
| Hover | the mark itself; masthead |
| Carry — the box on a ribbon | shipped / on its way |
| Carry — held close | shipped, where the art is small |
| Carry — the gift tag | a gift is on its way |
| Climb | welcome / order confirmed |
| Alight | out for delivery |
| Perched on the box | delivered |

Only the perch needed a part the artboard did not have: the two legs.

## In the emails — shipped

The arrangement is the MINT pattern in our register (`masthead-options.png`
weighs the four we considered; `emails/` mocked it; `sent/` is the real thing
rendered by the app):

1. **The wordmark stays the logo.** Emblem and MISTBOX at the top, smaller when
   a band follows. The bird is never the letterhead.
2. **A hero band** carries the headline beside the bird. The band is
   **forest**, and that is a measurement rather than a taste: gold is
   **5.07:1** on forest against **1.96:1** on bone, so it is the only ground the
   contour has presence on.
3. **The bird signs off.** The body stays in the brand's voice; one line is the
   bird's — *"Packed with care,"*, *"On my way,"*, *"Left at your door,"* —
   followed by the foil mark and *the Mist Bird*. That signature is the whole
   difference between a correspondent and a decoration.

Unlike MINT, **the headline is live text on a background colour**, not set into
the hero image. Before the site is public the artwork travels as a data URI,
which Gmail blocks; an email whose headline lived in the image would arrive
blank. The plain-text alternative carries the sign-off too.

| Where | What |
|---|---|
| `tools/bird-assets.mjs` | writes the 2× PNGs into `storefront/public/` |
| `src/lib/email/send.ts` | `POSE_FOR` maps each email to its pose; `assetSrc` inlines locally, links once deployed |
| `src/lib/email/layout.ts` | the hero band and the sign-off, both conditional |
| `src/lib/content.ts` | `EmailCopy.signoff`, with a default per email |

Re-run `node tools/bird-assets.mjs` after any change to the anatomy — the PNGs
are build output, not source.

## Still open

- **The sign-off line is code, not dashboard.** Deriving it from the Saleor page
  would mean claiming a paragraph position by convention, and a writer who did
  not know the rule would lose their last line into the signature. It moves to
  the dashboard when there is a field for it rather than a guess.
- **No newsletter template exists yet** — the mock in `emails/3-newsletter.png`
  shows the shape, but nothing sends it.
- The artboards in `art/` are the original design-canvas exports, kept as the
  provenance of the geometry. They still carry the **uncorrected** bill.
