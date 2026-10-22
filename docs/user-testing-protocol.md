# User testing protocol

A protocol for finding out whether QForge actually teaches anyone anything.

**No testing has been run yet. This document contains no results, no
participants and no findings, because none exist.** Section 6 is the empty
table they would go in. A portfolio claim of "validated with users" made
before that table has rows in it would be false, and is not made anywhere in
this repository.

---

## 1. What this is trying to find out

Not "do people like it". Liking is cheap and uninformative. The questions worth
answering are:

**Q1. Can someone who has never seen QForge write a working program?**
The measurable form: time from opening the studio to a circuit of their own
that compiles and runs, without help.

**Q2. Do the diagnostics actually diagnose?**
When a participant makes a mistake, does the error message let them fix it
themselves, or do they get stuck?

**Q3. Does the step debugger change what people understand?**
Specifically: can a participant correctly answer a question about entanglement
_after_ stepping through a Bell state that they could not answer before?

**Q4. Which explanation is load-bearing?**
Every walkthrough claims the panel beside it proves the claim. Do participants
look at the panel, or read past it?

**Q5. What do they try that does not exist?**
A list of attempted syntax that fails is the single most useful output of a
session, because it is a direct measurement of the gap between the language in
someone's head and the language that exists.

---

## 2. Who to test with

Three groups, because they fail differently:

| Group                                    | Size | Why                                                    |
| ---------------------------------------- | ---- | ------------------------------------------------------ |
| Has programmed, no quantum background    | 3–5  | The target user. Tests whether the quantum ideas land. |
| Has studied quantum, limited programming | 2–3  | Tests whether the _language_ is the obstacle.          |
| Neither                                  | 1–2  | Tests the floor: is the studio approachable at all?    |

Classmates, a physics or CS teacher, a university student, someone from an
online community. Ten people total is plenty; the returns fall off fast after
the first five for this kind of question.

**Consent.** Say before starting that you are testing the software, not them,
that they can stop at any time, and ask permission before recording anything.
If a participant is under 18, ask a parent or guardian first. Do not record
names in the repository — use P1, P2, P3.

---

## 3. Session structure (30 minutes)

Run it the same way every time, or the sessions are not comparable.

**0–2 min — Framing.** "This is a programming language for quantum circuits. I
want to find out where it is confusing. Think out loud. When you get stuck,
keep going until you decide to give up — I'll help then, but I want to see
where you get stuck first."

**2–5 min — Prior knowledge, recorded before anything is shown.** Ask Q3's
question cold and write down the answer verbatim:

> "Two qubits are in a Bell state. If I measure the first one and get 1, what
> will I get if I measure the second? How confident are you?"

**5–12 min — Unguided exploration.** Open the studio, say nothing else. Watch
what they click. **Do not help.** Note every point where they pause for more
than ten seconds.

**12–20 min — Task.** "Write a program with two qubits that always gives the
same result for both." Time it. Note every error message they hit and whether
they recovered from it unaided.

**20–26 min — One walkthrough.** Have them run the Entanglement walkthrough.
Note whether they look at the panel the lesson points at. After the step that
claims `|r| = 0 for both`, ask: "What on the screen tells you that?"

**26–30 min — Ask Q3's question again**, then the questionnaire.

---

## 4. What to write down during the session

Observation beats self-report, so the notes matter more than the questionnaire.

- **Timestamped sticking points.** Where they paused, what they said.
- **Every error message hit**, and whether the next edit fixed it. This is the
  direct measurement for Q2.
- **Every piece of syntax they tried that does not exist.** Verbatim. This is
  Q5, and it is the most actionable output.
- **Whether they looked at the panel** a walkthrough step pointed at, or read
  past it. Q4.
- **The exact words** they used for anything they found confusing. Their words
  are better documentation than yours.

---

## 5. Questionnaire

Short, administered after the session, in their own words rather than on a
scale wherever possible.

**Closed (for comparison across participants):**

1. Before today, had you written any quantum program? (yes / no)
2. Did you get a two-qubit program working? (yes / no / with help)
3. How clear were the error messages? (1 = meaningless, 5 = told me exactly
   what to fix)
4. Did the step debugger help you understand what was happening? (1–5)
5. Would you use this to learn more? (yes / no / maybe)

**Open (where the useful answers are):**

6. What was the single most confusing moment?
7. What did you expect to work that did not?
8. In your own words, what does entanglement mean? (Compare to the pre-session
   answer.)
9. The walkthrough said both Bloch vectors collapse to length 0. Did you check
   that on screen? What did you see?
10. What would you add or remove?

**Do not ask** "was it good?", "did you like it?", or "would you recommend
it?". Those produce politeness, not information.

---

## 6. Results

Empty by design. Each session gets a row; findings get an entry in §7; fixes
get a commit.

| Participant         | Group | Date | Wrote a working program? | Time to first run | Errors hit / self-recovered | Q3 before → after |
| ------------------- | ----- | ---- | ------------------------ | ----------------- | --------------------------- | ----------------- |
| _(no sessions run)_ |       |      |                          |                   |                             |                   |

---

## 7. Findings and what changed

Empty by design. The honest version of this section includes findings that were
_not_ acted on, with the reason.

| #        | Finding | Participants | Action | Commit |
| -------- | ------- | ------------ | ------ | ------ |
| _(none)_ |         |              |        |        |

---

## 8. How to report this honestly afterwards

When this protocol has been run, the claims that become available are narrow
and should be stated narrowly:

- "N participants, of whom M wrote a working two-qubit program unaided" — a
  fact, with the raw table beside it.
- "The most common blocker was X, observed in K of N sessions" — a fact.
- "Participants who stepped through the Bell example gave a more accurate
  answer about measurement correlation afterwards" — only if the before/after
  answers in §6 support it, and only as an observation about N people, not as
  evidence of pedagogical effect. N of ten is not a study.

What never becomes available from a protocol like this:

- Statistical significance. The sample is far too small, and there is no
  control group.
- "Users love it" or any claim about adoption.
- Any claim about learning outcomes beyond the specific question asked.

A small, honestly reported observation is worth more than an inflated one,
because the inflated one collapses the moment someone asks how many people
were tested.
