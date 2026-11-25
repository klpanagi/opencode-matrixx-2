# /bug-hunt — Evidence-Graded Defect Discovery

`/bug-hunt` is a read-only, advisory command that hunts for defects in a bounded
target. It does not patch code, does not gate CI, and does not report findings on
its own authority. Every finding carries an evidence grade, and the grade is only
as strong as the deterministic oracle behind it.

This document describes the command's formal method and the citation base that
grounds it. It is a reference for anyone running `/bug-hunt`, reviewing its
output, or extending its stage pipeline. The `bug-hunting` skill is the
authority for stage exit criteria and the tool matrix; this page summarizes them.

---

## Why a formal method

Finding bugs without a method is guesswork with extra steps. `/bug-hunt` treats
bug finding as program falsification, in the Popper sense: the auditor states a
hypothesis ("this function can receive a negative length"), then tries to refute
it by finding a case where the program behaves incorrectly. A hypothesis that
survives every refutation attempt stays a hypothesis. A hypothesis refuted by a
concrete run, a proof, or a sanitizer trace becomes a finding with evidence.

The hypothesis/refutation loop matters because of one uncomfortable empirical
fact: LLM-only bug detection is not reliable enough to stand on its own. The
PrimeVul study (Ding et al., ICSE 2025, arXiv:2403.18624) shows that benchmark
label noise inflates reported detection results, and that once realistic
vulnerability detection is measured honestly, code LLMs reach roughly 3-5% F1.
That number is the ceiling for "the model just looked at the code and said it is
bad". It is why this command insists that evidence comes from deterministic
tooling and execution: static analyzers, model checkers, fuzzers, sanitizers,
compilers, and test runners. The LLM participates, but it generates hypotheses;
it never certifies them.

The stages below formalize that loop. Each stage has a purpose, a named oracle,
an exit criterion, and an artifact. If a stage cannot run its oracle, the stage
does not silently pass; it records what was blocked (see Tool policy).

---

## Usage and flags

```
/bug-hunt [--scope=file|module|project] [--target=<path>] [--class=<odc-type|cwe-N|all>] [--depth=static|dynamic|deep] [--budget=N] [--verify=<run-N>]
```

The default scope is `file`, and only when `--target` names a file. Without a
file target the command hard-errors, asks for a target, and exits `2` with no
files written. There is no implicit "audit everything" mode.

| Flag | Values | Default | Notes |
|------|--------|---------|-------|
| `--scope` | `file`, `module`, `project` | `file`, and only when `--target` names a file | `module` scopes to the directory containing the target; `project` scopes to the full tree |
| `--target` | `<path>` | none | Required for `file` and `module` scope; must resolve inside the project root |
| `--class` | `<odc-type>`, `cwe-N`, `all` | `all` | ODC values: `function`, `interface`, `checking`, `assignment`, `timing`, `build-package`, `documentation`, `algorithms`, `other` |
| `--depth` | `static`, `dynamic`, `deep` | `static` | `dynamic` adds S5 sanitizers and fuzzing; `deep` adds S4 bounded verification. At `static`, S3 and S9 use in-process oracles only and anything needing the test runner is recorded as `blocked` |
| `--budget` | `N` | `20` | Maximum fully-evidenced findings; the unfunded remainder is recorded as `deferred` and the ledger run status becomes `incomplete` |
| `--verify` | `<run-N>` | none | Re-verifies a prior run through the S9 fresh-verifier pass; changed findings are revalidated |

### Exit codes

| Code | Meaning |
|:---:|---------|
| `0` | Clean: no confirmed findings |
| `1` | Findings: one or more confirmed findings |
| `2` | Invalid usage: bad flag value, missing or out-of-root target, unresolved `--verify` run id; nothing is written |

The command is advisory. It never fails a build and never gates CI; CI can read
the exit code, but no project pipeline should treat `1` as a build failure.

---

## The 10 stages

The pipeline runs S0 through S9 in order. Stages are not free-form: each one
produces an artifact the next stage consumes, and each one names the oracle that
decides whether it passed.

| Stage | Name | Purpose | Oracle | Exit criterion | Artifact |
|-------|------|---------|--------|----------------|----------|
| S0 | Frame | Fix scope, target, budget, and threat assumptions | Oracle agent frames S0; its oracle inventory seeds the coverage ledger | Scope, target, budget, and oracle inventory recorded; nothing scanned yet | Run frame |
| S1 | Invariant mining | Mine what the code claims is always true | Source reading, AST queries | Invariant list written, each tied to a code location | Invariant ledger |
| S2 | Static semantic analysis | Run deterministic analyzers over the target | clang-tidy, typecheck, taint, LSP diagnostics, ast-grep | All available analyzers ran; each blocked tool recorded as `blocked` | Analyzer report |
| S3 | Contract & property synthesis | Turn invariants into checkable contracts and properties | Invariant ledger + property templates | Contracts written in a testable form per language support; property tests live under `.matrixx/bugs/<run-N>/reproducers/` | Contract set |
| S4 | Bounded verification | Prove or refute contracts within bounded depth | CBMC, KLEE, Kani (bounded model checking) | Each contract: proven, refuted, or blocked; unbounded claims rejected | Verification log |
| S5 | Directed fuzzing + sanitizers | Execute the target against contracts | AFL/libFuzzer, ASan/UBSan/MSan, language test runners | Coverage-bounded run completed or blocked; crashes captured with inputs | Corpus + crash set |
| S6 | LLM hypothesis generation | Generate new refutation hypotheses from prior evidence | LLM (hypothesis only, never verdict) | Hypotheses written, each pointing at evidence already collected | Hypothesis queue |
| S7 | Reduction & root cause | Shrink any failing input to a minimal reproducer | Delta debugging (ddmin) | Minimal reproducer found or reduction bounded and recorded; reproducer written under `.matrixx/bugs/<run-N>/reproducers/` | Reduced repro |
| S8 | Fault localization | Pin the fault to code locations (trinity owns slicing and spectra) | Program slicing, Tarantula/Ochiai spectra | Ranked suspicious locations with the method that ranked them | Localization map |
| S9 | Adversarial validation | Try to kill each finding before reporting | Re-execution, cross-checking, alternative oracles | Every finding graded E3/E2/E1/E0 or dropped | Final evidence-graded report |

### Stage notes

Stage exit criteria are owned by the `bug-hunting` skill; these notes only add
the citation for each stage.

- **S0 Frame.** The oracle agent frames the run and seeds the coverage ledger
  with the oracle inventory; resolving scope, target, and budget is part of
  framing, not a scan.
- **S1 Invariant mining.** Borrows Engler et al.'s "bugs as deviant behavior"
  (SOSP 2001): code implies beliefs about itself, and contradictions are
  candidates.
- **S2 Static semantic analysis.** Only deterministic analyzers count as an
  oracle; missing ones become `blocked` ledger units, never silent coverage.
- **S3 Contract & property synthesis.** Hoare logic (CACM 1969) supplies the
  pre/post form; QuickCheck (ICFP 2000) supplies the property-based form.
- **S4 Bounded verification.** Model checkers prove or refute within explicit
  bounds; nothing here claims unbounded correctness.
- **S5 Directed fuzzing + sanitizers.** Fuzzing is directed by the S3 contracts;
  the Manès et al. survey (arXiv:1812.00140) frames what counts as a fuzzer run.
- **S6 LLM hypothesis generation.** The only stage where the LLM leads, and it
  leads only as a hypothesis source; IRIS (ICLR 2025) is the productive pattern.
- **S7 Reduction & root cause.** Delta debugging (Zeller and Hildebrandt, IEEE
  TSE 2002) shrinks a failing input to a minimal reproducer.
- **S8 Fault localization.** Slicing (Weiser, IEEE TSE 1984) plus Tarantula
  (Jones and Harrold, ASE 2005) or Ochiai (Abreu et al., PSB 2007); trinity owns
  S8, and Wong et al. (IEEE TSE 2016) bounds what the techniques promise.
- **S9 Adversarial validation.** Every candidate gets one round of attempted
  refutation; survivors are graded, the rest are dropped with the refutation
  recorded.

---

## Evidence ladder

Every finding carries one grade. The grade determines what the report is
allowed to claim.

| Grade | Name | Proof required | Severity policy |
|-------|------|----------------|-----------------|
| E3 | Proven | A deterministic proof: model-checker refutation with bounds stated, a sanitizer-diagnosed memory/UB violation with a stack, or an exhaustive proof over the bounded domain; a reproducer is optional | Severity optional |
| E2 | Reproduced | A minimized deterministic test or property stored under `.matrixx/bugs/<run-N>/reproducers/` that fails every run on this codebase | Severity optional; reproducer required |
| E1 | Witnessed | A static invariant violation plus a concrete slice witness (data/control path shown), but no reproducing execution | Severity optional; capped at medium |
| E0 | Candidate | An unverified hypothesis, typically from S6, with no oracle backing | Status `needs_validation` required; severity MUST be absent |

Rules:

- Severity is optional at E1, E2, and E3 (any `SeveritySchema` value: critical,
  high, medium, low, informational), forbidden at E0, and capped at medium for E1.
- A reproducer is required at E2 only; it is optional at E3.
- `reproducer` is written relative to the run directory and starts with `reproducers/`
  (for example `reproducers/case1.test.ts`); the `.matrixx/bugs/<run-N>/` prefix belongs
  to prose, not to the field, and the schema rejects it.
- `location.path` is a project-relative source path: no `..` segment and no absolute
  prefix.
- E0 findings carry `status: needs_validation` and no severity. This matches the
  finding lifecycle used elsewhere in this repository (`confirmed`,
  `needs_validation`, `rejected`, `deferred`).
- E1 findings are capped at medium severity regardless of what the tool claims.
  A flag without a reproduction is a lead, not a verdict.
- A finding with no evidence at all is not a finding. It is a hypothesis, and
  hypotheses live in the S6 queue, not in the report.

---

## Target safety

These rules are hard; violating one is invalid usage (exit `2`, nothing written).

1. `--target` must resolve inside the project root. If it does not, hard-error
   with exit `2` and write nothing.
2. Never read or copy secret material: skip `.env*`, `*.pem`, `*.key`, `id_*`,
   credential stores, and any file the user marks excluded. Never print or
   persist secret values in any artifact field.
3. `--depth=dynamic` or `deep` builds and executes project code (S4/S5 and the
   test runner). Only the current checkout, under the user's trust, may be built
   or executed. For a third-party or untrusted `--target`, S5 is `blocked` and
   recorded as such — never silently skipped.

---

## Tool policy

The `bug-hunting` skill's TOOL MATRIX is the single authority for language
coverage and tool support; this page does not duplicate it.

The policy is **detect-and-degrade**: at S0 the run checks which oracles are
available, and the pipeline degrades gracefully rather than silently skipping.

- A missing tool becomes a ledger unit with status `blocked` and exactly one
  install hint. The report states, per unit, what was not checked.
- Optional tools carry the same rule: absent means `blocked` plus one hint, never a
  silent skip. Which tools are optional, and at which depth they become usable, is
  recorded in the skill's TOOL MATRIX.
- Never silent coverage. A report that does not distinguish "checked and clean"
  from "not checked" is invalid.
- Blocked units never lower a finding's grade. They lower confidence in the
  coverage claim, which the ledger records.
- A language outside the matrix is recorded as `out_of_scope`, never silently
  skipped.

---

## Artifacts

A run writes only under `.matrixx/bugs/<run-N>/`, where `run-N` is allocated
exclusively (never reused):

| Path | Contents |
|------|----------|
| `run-metadata.json` | `run` id, `startedAt`, scope, target, flags, depth, budget, `funded`, run status |
| `coverage-ledger.json` | One unit per in-scope location with status (`covered`, `blocked`, `deferred`, `out_of_scope`, `not_applicable`) and the oracle inventory |
| `findings.json` | Tiered findings (`reproducer` run-relative, `location.path` project-relative) with oracle, witness, root cause, remediation, and `cross_ref` pointers |
| `reproducers/` | Property tests and minimized reproducers (also written here at S3 and S7) |

`.matrixx/` is gitignored, so hunt artifacts stay local to the checkout and are
never committed.

---

## Boundaries

`/bug-hunt` shares a neighborhood with other read-only commands and skills.
The table separates them so runs do not duplicate work or blur authority.

| Neighbor | It owns | `/bug-hunt` does | Cross-reference |
|----------|---------|------------------|-----------------|
| `/security-audit` | Security vulnerability classes (CWE-style findings) | Delegates security-class findings entirely; reports only the cross-reference, never the finding itself | Yes, mandatory when a candidate is security-class |
| `/quality-audit` | Deterministic quality grading (structure, complexity, dead code) | Complementary: `/quality-audit` grades what is there, `/bug-hunt` falsifies what it claims | Optional |
| `systematic-debugging` (skill) | A known, already-failing behavior | Different entry point: debugging starts from a failure, hunting starts from hypotheses | Optional |
| `silent-failure-detection` (skill) | Swallowed errors and silent catch blocks | Uses `silent_failure_scan` in S2 and hands swallow findings to the skill's taxonomy | Yes, for silent-failure findings |

The security delegation rule is strict: if a finding falls into a security
vulnerability class, `/bug-hunt` stops, records it as a `cross_ref`, and lets
`/security-audit` produce the graded finding. It does not start a security-audit
run and does not write `.matrixx/audits/`. Running both commands over the same
target is legitimate; each keeps its own ledger.

---

## Citation base

Most claims in this document trace to an entry below; where a claim is not
covered, see "Confidence and corrections" for its status.

| Work | Authors | Venue + Year | Identifier | What it grounds |
|------|---------|--------------|------------|-----------------|
| LLM-Assisted Static Analysis for Detecting Security Vulnerabilities (IRIS) | Ziyang Li, Saikat Dutta, Mayur Naik | ICLR 2025 | arXiv:2405.17238 | S6 pattern: neuro-symbolic loop where CodeQL dataflow yields path constraints and the LLM acts as oracle over candidate paths; on CWE-Bench-Java detects 55 vulnerabilities vs CodeQL's 27 (GPT-4), false-discovery rate 5.21% lower than CodeQL; found 4 previously unknown vulns in 30 Java projects |
| RepoAudit: An Autonomous LLM-Agent for Repository-Level Code Auditing | Jinyao Guo, Chengpeng Wang, Xiangzhe Xu, Zian Su, Xiangyu Zhang | arXiv 2025 (accepted at ICML 2025 per official project page; moderate confidence) | arXiv:2501.18160 | Multi-agent audit structure: explorer performs on-demand data-flow analysis, validator re-checks findings to eliminate false positives; grounds S6/S9 split |
| Enhancing Static Analysis for Practical Bug Detection: An LLM-Integrated Approach (LLift) | Haonan Li, Yu Hao, Yizhuo Zhai, Zhiyun Qian (UC Riverside) | OOPSLA 2024 | DOI 10.1145/3649828 | Integrating an LLM into static analysis to resolve hard analysis facts; demonstrated on use-before-initialization bugs in C/C++; grounds S2/S6 cooperation |
| From Naptime to Big Sleep: Using Large Language Models To Catch Vulnerabilities In Real-World Code | Google Project Zero + Google DeepMind | Nov 1, 2024 blog post | projectzero.google/2024/10/from-naptime-to-big-sleep.html | First real-world vulnerability found by an LLM agent: stack buffer underflow in the SQLite dev branch via variant analysis; grounds the existence proof for S6 hypothesis quality; no further claim made |
| Vulnerability Detection with Code Language Models: How Far Are We? (PrimeVul) | Yangruibo Ding et al. | ICSE 2025 | arXiv:2403.18624 | Empirical justification for the whole method: benchmark label noise inflates results; realistic F1 ~3-5% for code LLMs on realistic vuln detection |
| SWE-bench: Can Language Models Resolve Real-World GitHub Issues? | Jimenez et al. | ICLR 2024 | arXiv:2310.06770 | Grounds the reproduction bar: resolving an issue means a real repo test goes green; E2 requires the same shape |
| Automated Unit Test Improvement using Large Language Models at Meta (TestGen-LLM) | Alshahwan et al. | FSE 2024 SEIP industry track | arXiv:2402.09171 | Grounds S9: candidate tests accepted only when they demonstrably improve a measured property |
| Mutation-Guided LLM-based Test Generation at Meta | Foster, Gulati, Harman, et al. | FSE 2025 | DOI 10.1145/3696630.3728544 | Grounds S5/S9: mutants as kill-targets for generated tests |
| Simplifying and Isolating Failure-Inducing Input | Zeller, Hildebrandt | IEEE TSE 28(2), 2002, pp.183-200 | DOI omitted | S7: ddmin / delta debugging |
| Why Programs Fail: A Guide to Systematic Debugging | Zeller | Morgan Kaufmann, 2nd ed., 2009 | ISBN book | The hypothesis/refutation framing of the whole method |
| Bugs as Deviant Behavior: A General Approach to Detect Anomalies | Engler, Chen, Hallem, Chou, Chelf | SOSP 2001 | DOI omitted | S1: invariant mining from code-implied beliefs |
| Program Slicing | Weiser | IEEE TSE 10(4), 1984, pp.354-357 | DOI omitted | S8: slicing for localization |
| Abstract Interpretation: A Unified Lattice Model for Static Analysis of Programs by Construction or Approximation of Fixpoints | Cousot, Cousot | POPL 1977, pp.238-252 | DOI omitted | S4: bounded, sound-by-construction analysis semantics |
| Orthogonal Defect Classification: A Concept for In-Process Measurements | Chillarege et al. | IEEE TSE 18(11), 1992, pp.943-956 | DOI omitted | Finding taxonomy and severity policy discipline |
| Empirical Evaluation of the Tarantula Automatic Fault-Localization Technique | Jones, Harrold | ASE 2005, pp.273-282 | DOI omitted | S8: Tarantula spectrum coefficient |
| An Evaluation of Similarity Coefficients for Software Fault Localization | Abreu, Zoeteweij, van Gemund | PSB 2007 | DOI omitted | S8: Ochiai coefficient |
| A Survey on Software Fault Localization | Wong, Gao, Li, Abreu, Wotawa | IEEE TSE 42(8), 2016, pp.707-740 | DOI 10.1109/TSE.2016.2521368 | S8: what localization techniques can and cannot promise |
| QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs | Claessen, Hughes | ICFP 2000, pp.268-279 | DOI omitted | S3/S5: property-based testing form |
| Hints on Test Data Selection: Help for the Practicing Programmer | DeMillo, Lipton, Sayward | IEEE Computer 11(4), 1978, pp.34-41 | DOI omitted | Test selection and the mutation-adequacy tradition behind S9 |
| KLEE: Unassisted and Automatic Generation of High-Coverage Tests for Complex Systems Programs | Cadar, Dunbar, Engler | OSDI 2008 | DOI omitted | S4/S5: bounded symbolic execution |
| A Tool for Checking ANSI-C Programs (CBMC) | Clarke, Kroening, Lerda | TACAS 2004, LNCS 2988, pp.168-176 | DOI omitted | S4: bounded model checking for C |
| The Art, Science, and Engineering of Fuzzing: A Survey | Manès et al. | IEEE TSE (accepted 2019, published 2021) | arXiv:1812.00140 | S5: fuzzing taxonomy and what counts as a fuzzer run |
| An Axiomatic Basis for Computer Programming | Hoare | CACM 12(10), 1969 | DOI omitted | Foundational: Hoare logic behind S3 contracts |

---

## Confidence and corrections

Moderate-confidence venues (stated, not hidden):

- **RepoAudit, ICML 2025.** The arXiv identifier (2501.18160) is solid. The
  ICML 2025 acceptance comes from the official project page, not from
  proceedings checked here. Confidence: moderate. Cite as "arXiv 2025
  (accepted at ICML 2025 per official project page)".

Corrections and scope statements:

- **IRIS is academic, not DeepMind.** IRIS (arXiv:2405.17238) is a
  UPenn/JHU academic paper by Ziyang Li, Saikat Dutta, and Mayur Naik,
  published at ICLR 2025. It is not a Google DeepMind work, and it is not
  related to Project Zero's Big Sleep despite the adjacent topic.
- **Big Sleep claim is narrow on purpose.** The grounded claim is exactly:
  an LLM agent found a real-world vulnerability (a stack buffer underflow in
  the SQLite dev branch) via variant analysis, as reported by Google Project
  Zero and Google DeepMind on Nov 1, 2024. No breadth, frequency, or
  generalization claims are made beyond that.
- **LLift author list.** The paper is OOPSLA 2024 (DOI 10.1145/3649828), and its
  authors are Haonan Li, Yu Hao, Yizhuo Zhai, and Zhiyun Qian (UC Riverside).
  The PDF's first author is Haonan Li. Where a DOI is unknown or was not
  verified, this doc writes "DOI omitted" rather than inventing one.
- **PrimeVul is the justification, not a participation trophy.** The 3-5% F1
  figure is used to justify deterministic oracles, not to rank models. No
  model-specific numbers from PrimeVul are reproduced in this doc.
- **Security delegation.** Combined with `/security-audit`, security-class
  findings are delegated to that command; `/bug-hunt` only cross-references
  them and never reports them as its own.
