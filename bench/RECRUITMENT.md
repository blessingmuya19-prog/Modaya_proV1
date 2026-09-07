# Rater recruitment copy (Mixed route: 3 Prolific + 2 network)

Decisions: media = own footage + stock refs (36 pairs); raters = mixed
route. Fill the blanks, paste, and go.

---

## 1. Network post (2 raters — use as-is)

> **Paid ~R300 for ~3 hours of video watching — media evaluation study**
>
> I'm building an AI video editor and need honest outside opinions on 36
> short edit-vs-reference comparisons. Not a focus group, no interviews —
> just you, a private link, and a rating sheet.
>
> What you do: 3 sessions of ~1 hour each (12 comparisons per session).
> For each: watch a 30–60s reference clip, watch a 1–3 min edit, score
> 1–5 on three questions, write one sentence on the biggest difference.
> Sessions can be spread over a week.
>
> Requirements:
> - You are comfortable scoring things 1–5 and *saying what's wrong*.
> - You must not know anything about how the edits were made — I won't
>   tell you, and if you already know, please don't volunteer.
> - Stable internet + a screen bigger than a phone.
>
> Pay: R150 per 1-hour session, R300 for all three (paid after the last
> session, bank transfer or voucher). I'll send a short calibration
> example first so we're scoring the same scale.
>
> Reply or message me: [contact].

**Don't** send this to: anyone who worked on the product, anyone who saw
the pipeline code, or anyone you'd feel awkward receiving a 1/5 from.

## 2. Prolific study (3 raters)

**Study title:** Score AI video edits against a reference (video watching)
**Description:**
> You'll watch short video clips and score AI-made edits against a
> reference. Three sessions (12 comparisons each, ~60–70 min total per
> session). You need a laptop/desktop with sound, and a stable connection.
> Each comparison: watch the reference (30–60s), watch the edit (1–3 min),
> answer three 1–5 questions and one short free-text "what's the biggest
> difference" question. There's a 2-minute paid calibration demo first.
> No video-editing experience needed — we want ordinary viewers.
> An attention check is built in; sessions that fail it are rejected
> before payment. Time estimates are honest, not padded.
>
> Reward: £9–11 per session (≈£27–33 total for all three).

**Setup notes for the owner:**
- 3 waves in Prolific (one per 12-pair session), each wave is its own
  submission and must meet the minimum hourly rate on its own.
- Host the 36 edits + references at public URLs (object storage / a
  vercel blob / a simple static page per pair). Prolific participants
  cannot reach a localhost or sandbox preview.
- Screener: confirm the participant can hear audio and has a desktop —
  no other screening; we want ordinary viewers, not editors.
- Include the calibration demo as a free-standing first study page and
  the attention-check pair repeated in each wave.

## 3. Calibration script (both groups — read aloud at session 1)

> I'm rating edits against a reference. The scale is:
> **1** nothing alike — wrong pacing, wrong captions, wrong emphasis.
> **2** a hint of the reference, mostly lost.
> **3** a recognisable attempt, not quite — one or two things are close.
> **4** close — a viewer would say "this is definitely that style".
> **5** feels like the same editor made both.
> Score what you actually see. If you can't see or hear something, mark the
> row `blind` and say so — honest gaps are better than guesses. "Why" is
> one sentence on the single biggest difference, not a paragraph.

## 4. Anti-bias rules (standing)

1. Never show old-vs-new side by side (baseline only has old anyway).
2. Per-rater shuffled order (the generator does this).
3. `blind: true` rows are excluded from feel-match by the scorer.
4. Rater who fails the attention check → session excluded, not averaged.
5. Nobody who built or saw the pipeline rates anything.
