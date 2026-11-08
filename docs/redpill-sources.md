# The Matrixx Manifesto — Evidence Map

> **Status:** living audit document. This is the audit layer of the two-layer doctrine.
>
> **Layer 1 (the manifesto):** `docs/redpill-manifesto.md` — deliberately carries no citations.
> **Layer 3 (domain pack):** `docs/redpill-domain-software.md` — adds software-specific calibration.
>
> The manifesto body must stay short and domain-neutral. This file is where every claim is
> traceable. If a principle cannot be sourced here, it is engineering judgment and must be
> labelled as such — not dressed as science.

## Why this document exists

A manifesto that says "scientifically grounded" without a source map is citation theatre.
This document does three things:

1. Maps each manifesto principle to primary literature.
2. Grades the strength of the evidence for the *specific claim* the principle makes.
3. States what the evidence does **not** support, so the doctrine cannot overclaim.

The evidence is strongest for **component mechanisms** — pre-commitment, goal specificity,
independent replication, structured feedback, checklists with implementation support, debriefs,
and calibration. There is **no peer-reviewed study of this composite manifesto**, and no study
of an LLM agent following it. That limit is recorded below and must survive every future edit.

## Evidence grades

| Grade | Meaning |
|---|---|
| **A** | Replicated or meta-analytic: systematic review, meta-analysis, or multi-site replication with consistent effects. |
| **A−** | Strong narrative review or a large, consistent body of primary studies; not a single pooled estimate. |
| **B** | Peer-reviewed primary studies, consensus standards, or strong quasi-experiments; not necessarily replicated. |
| **C** | Single study, theoretical argument, or transfer by analogy. |
| **D** | Practitioner synthesis, standards document, or reasoned engineering judgment; not causal evidence. |

A high grade does not mean the principle is universally true. It means the source is strong for
the narrow claim in the "What it supports" column. A low grade does not mean the principle is
wrong; it means the doctrine is making a judgment call and should say so.

## Principle-to-source map

| # | Principle | Primary sources | Grade | What the evidence supports | Caveat |
|---|---|---|---|---|---|
| P1 | Pre-register the objective | Locke & Latham 2002; Nosek et al. 2018; Gollwitzer & Sheeran 2006 | A− | Specific, difficult goals outperform vague goals across hundreds of studies; written pre-commitment improves follow-through. | Goal effects depend on commitment, task complexity, and feedback. A written objective is not a guarantee of execution. |
| P2 | Pre-commit the acceptance criteria | Nosek et al. 2018; Simmons et al. 2011; Gollwitzer & Sheeran 2006 | A / B | Undisclosed degrees of freedom inflate false positives; implementation intentions (if–then plans) show a medium-to-large effect (d ≈ 0.65). | The meta-analytic evidence is for implementation intentions, not for every form of "acceptance criteria". Preregistration outcome evidence is observational. |
| P3 | Pre-commit the falsifier | Chambers 2013; Chambers & Tzavella 2022; Ioannidis 2005 | B | Review-before-result models are feasible and widely adopted; pre-study odds and bias make single positive findings weak evidence. | Adoption is not the same as proven improvement. The causal effect of Registered Reports on research quality is still being measured. |
| P4 | Separate the plan from the observation | Nosek et al. 2018; Open Science Collaboration 2015; Simmons et al. 2011 | A / B | A large share of published findings fail to replicate; effect sizes shrink on replication; flexibility in analysis inflates false positives. | The replication crisis is strongest in psychology and social science. Transfer to other domains is inferential. |
| P5 | Report the method, not just the result | Page et al. 2021 (PRISMA 2020); Munafò et al. 2017 | B | Structured reporting improves completeness, auditability, and reproducibility of reviews and research. | Reporting quality is not the same as research quality. A well-reported weak study is still weak. |
| P6 | Make the work inspectable by a stranger | Nosek et al. 2015 (TOP); Kidwell et al. 2016; Munafò et al. 2017 | B | Transparency standards and low-cost badges shift sharing behaviour (data sharing rose from ~3% to 23–39% in one journal). | Badges measure disclosure, not correctness. Inspectability enables verification; it does not replace it. |
| P7 | Verify on the real surface | Ioannidis 2005; Errington et al. 2021; Munafò et al. 2017 | B | Preclinical cancer replication was low; proxies and internal signals can diverge sharply from the real outcome. | The strongest evidence is from biomedical replication. The engineering claim ("test the real surface") is judgment plus analogy. |
| P8 | Independent verification over self-review | Open Science Collaboration 2015; Many Labs 1/2/3; Camerer et al. 2016, 2018 | A | Independent teams replicate far less than original authors expect; replication success varies by field and claim strength. | Independence is procedural, not guaranteed. A second reviewer can share the same blind spot. |
| P9 | Grade confidence and state the limits | Guyatt et al. 2008 (GRADE); Sackett et al. 1996 | B | Separating confidence in evidence from strength of recommendation reduces overconfident action; evidence-based practice requires expertise and stakeholder values, not rule-following. | GRADE was built for clinical evidence. Its transfer to general knowledge work is analogical. |
| P10 | Iterate small and debrief | Tannenbaum & Cerasoli 2013; Taylor et al. 2014; Buehler et al. 1994 | B / C | Structured debriefs improve performance (~25% in a meta-analysis); PDSA cycles can improve processes when implemented with fidelity; people systematically underestimate completion time. | PDSA evidence is mostly observational and often diluted in practice. Debrief effects depend on structure and psychological safety. |
| P11 | Use checklists, but fix the system | Pronovost et al. 2006; Haynes et al. 2009; Urbach et al. 2014 | B | Checklists plus bundle implementation reduced infections and surgical mortality in large before–after studies. | A mandated checklist alone showed no effect in Ontario (Urbach et al. 2014). Implementation, culture, and ownership matter more than the artifact. |
| P12 | Record, version, and revise the truth | Munafò et al. 2017; Nosek et al. 2018; Kidwell et al. 2016; DORA 2012; Moher et al. 2020 | B | Durable records, versioned materials, and assessment criteria that reward integrity improve the ability to audit and reuse work. | Record-keeping is a necessary condition, not a sufficient one. A complete record of a bad decision is still a bad decision. |

## Protocol-to-source map

The protocol steps are **procedures**, not empirical claims. Some are directly supported; others
are engineering judgment. This table keeps that distinction explicit.

| Protocol step | Sources | Grade | Note |
|---|---|---|---|
| Classify intent before acting | — | D | Decision hygiene and role discipline. No direct trial evidence. |
| Goal Registration | Locke & Latham 2002; Nosek et al. 2018 | A− / B | Supported as goal specificity plus pre-commitment; the exact "3+ scenarios" count is a design choice. |
| Scenario Contract (3+ binary scenarios) | Nosek et al. 2018; Gollwitzer & Sheeran 2006; Simmons et al. 2011 | B | Pre-commitment and falsifiability are supported; the number three is a heuristic. |
| Falsify-first loop | Ioannidis 2005; Chambers 2013 | C | Popperian logic plus metascience analogy. The loop itself is engineering judgment. |
| Durable Evidence Log | — | D | Supports auditability and context recovery; no causal outcome evidence. |
| Delegate to the right specialist | — | D | Division of labour and expertise. Adjacent team-debrief evidence only. |
| Self vs delegate threshold | Buehler et al. 1994 | C | Planning-fallacy evidence supports humility about effort estimates; the threshold is a heuristic. |
| Acceptance Criteria + QA Execution | Locke & Latham 2002; Hattie & Timperley 2007; Kluger & DeNisi 1996; Guyatt et al. 2008 | B | Goal specificity and task-focused feedback are supported; feedback is heterogeneous and can harm performance in over one-third of cases. |
| Stop honestly after two failures | Ioannidis 2005; Cairney & Oliver 2017 | C | Sunk-cost and escalation-of-commitment logic; the "two" is a heuristic. |
| Re-read the request before claiming done | — | D | Communication discipline. No direct evidence. |

## Coverage of the five reproducibility pillars

Munafò et al. (2017) organize reproducibility around five pillars. The manifesto maps as follows:

| Pillar | Manifesto coverage |
|---|---|
| Methods | P1, P2, P4; protocol 2–4 |
| Reporting and dissemination | P5, P6, P12 |
| Reproducibility | P3, P7, P8; the verification guarantee |
| Evaluation | P9, P10, P11 |
| Incentives | P12; DORA and the Hong Kong Principles at the system level |

## Contested and conditional findings

These are the places where a careless manifesto would overclaim. Keep them visible.

### Deliberate practice is contested

- Ericsson et al. (1993) framed deliberate practice as the central driver of expertise.
- Macnamara et al. (2014) meta-analysis found practice explained 26% of variance in games, 21% in music, 18% in sports, 4% in education, and less than 1% in professions.
- Macnamara & Maitra (2019) reanalysis of the violin data found 26% of proficiency variance.

**Ruling:** do not build a principle on "practice guarantees excellence." The defensible claim is
that structured practice is one contributor among many, and its contribution is domain-dependent.

### Pre-mortems are promising but not firmly established

- Mitchell et al. (1989) found that "prospective hindsight" improves the ability to identify reasons for future outcomes.
- Klein (2007) popularized the team pre-mortem as a practitioner method.

**Ruling:** keep the pre-mortem as a useful team procedure (grade D/C), not as an empirically
proven intervention.

### Checklists are conditional

- Pronovost et al. (2006) and Haynes et al. (2009) found large improvements when checklists were paired with implementation and culture change.
- Urbach et al. (2014) found no effect when surgical safety checklists were mandated in Ontario.

**Ruling:** the checklist is not the active ingredient. Implementation, ownership, and culture are.
The manifesto says "use checklists, but fix the system" for this reason.

### Feedback can backfire

- Kluger & DeNisi (1996) found that feedback interventions improved performance on average but harmed it in over one-third of cases.
- Hattie & Timperley (2007) show that task-focused feedback with a clear "where to next" is more effective than praise or personal feedback.

**Ruling:** "independent verification" must be task-focused and specific. Vague or personal
feedback is not automatically good.

### Evidence-based management has thin causal evidence

- Rousseau (2006) makes the theoretical case for evidence-based management.
- Barends et al. (2014) codify the practice (ASK → ACQUIRE → APPRAISE → AGGREGATE → APPLY → ASSESS).

**Ruling:** the decision procedure is a reasonable professional standard (grade D), not a proven
causal intervention. Do not claim that EBMgt "scientifically proven to improve performance."

### Evidence-based policy is not evidence-based medicine

- Cairney & Oliver (2017) argue that policy is not a clinical intervention: values, interests, and
  institutional constraints are part of the problem.
- Oliver et al. (2014) document barriers to and facilitators of evidence use by policymakers.

**Ruling:** "follow the evidence" is necessary but not sufficient in multi-stakeholder work.
The manifesto's "state the limits" principle exists to make that visible.

## What this evidence does not establish

1. **No study tests this composite manifesto.** The sources support components, not the bundle.
2. **No study tests an LLM agent following this manifesto.** Agent behaviour is not human behaviour,
   and prompt adherence is not the same as skill.
3. **Transfer is inferential.** Most evidence comes from psychology, medicine, and organizational
   behaviour. Applying it to general knowledge work is an analogy, not a direct result.
4. **Publication bias and WEIRD samples limit generalization.** The replication literature is
   itself biased toward certain fields, populations, and claim types.
5. **Average effects hide heterogeneity.** An intervention that helps on average can harm in a
   specific context. Local verification is not optional.
6. **Top-venue publication is not a reliability guarantee.** The replication literature exists
   precisely because prestigious venues publish unreliable findings.

## References

Primary literature and consensus standards are listed first; practitioner works are labelled.

- Barends E, Rousseau DM, Briner RB. *Evidence-Based Management: The Basic Principles.* Center for Evidence-Based Management; 2014. https://cebma.org/ (practitioner standard)
- Brier GW. Verification of forecasts expressed in terms of probability. *Monthly Weather Review.* 1950;78(1):1–3.
- Buehler R, Griffin D, Ross M. Exploring the "planning fallacy": Why people underestimate their task completion times. *Journal of Personality and Social Psychology.* 1994;67(3):366–381. doi:10.1037/0022-3514.67.3.366
- Cairney P, Oliver K. Evidence-based policymaking is not like evidence-based medicine, so how far should you go to bridge the divide between evidence and policy? *Health Research Policy and Systems.* 2017;15:35. doi:10.1186/s12961-017-0192-x
- Camerer CF, Dreber A, Forsell E, et al. Evaluating replicability of laboratory experiments in economics. *Science.* 2016;351(6280):1433–1436. doi:10.1126/science.aaf0918
- Camerer CF, Dreber A, Holzmeister F, et al. Evaluating the replicability of social science experiments in Nature and Science between 2010 and 2015. *Nature Human Behaviour.* 2018;2(9):637–644. doi:10.1038/s41562-018-0399-z
- Chambers CD. Registered Reports: A new publishing initiative at Cortex. *Cortex.* 2013;49(3):609–610. doi:10.1016/j.cortex.2012.12.016
- Chambers CD, Tzavella L. The past, present and future of Registered Reports. *Nature Human Behaviour.* 2022;6(1):29–42. doi:10.1038/s41562-021-01193-7
- DORA. *San Francisco Declaration on Research Assessment.* 2012. https://sfdora.org/read/
- Dreber A, Pfeiffer T, Almenberg J, et al. Using prediction markets to estimate the reproducibility of scientific research. *PNAS.* 2015;112(50):15343–15347. doi:10.1073/pnas.1516179112
- Ebersole CR, Atherton OE, Belgrave AL, et al. Many Labs 3: Evaluating participant pool quality across the academic semester via replication. *Journal of Experimental Social Psychology.* 2016;67:68–82. doi:10.1016/j.jesp.2015.10.012
- Ericsson KA, Krampe RT, Tesch-Römer C. The role of deliberate practice in the acquisition of expert performance. *Psychological Review.* 1993;100(3):363–406. doi:10.1037/0033-295X.100.3.363
- Errington TM, Mathur M, Soderberg CK, et al. Investigating the replicability of preclinical cancer biology. *eLife.* 2021;10:e71601. doi:10.7554/eLife.71601
- Gollwitzer PM, Sheeran P. Implementation intentions and goal achievement: A meta-analysis of effects and processes. *Advances in Experimental Social Psychology.* 2006;38:69–119. doi:10.1016/S0065-2601(06)38002-1
- Guyatt GH, Oxman AD, Vist GE, et al. GRADE: an emerging consensus on rating quality of evidence and strength of recommendations. *BMJ.* 2008;336(7650):924–926. doi:10.1136/bmj.39489.470347.AD
- Hattie J, Timperley H. The power of feedback. *Review of Educational Research.* 2007;77(1):81–112. doi:10.3102/003465430298487
- Haynes AB, Weiser TG, Berry WR, et al. A surgical safety checklist to reduce morbidity and mortality in a global population. *New England Journal of Medicine.* 2009;360(5):491–499. doi:10.1056/NEJMsa0810119
- Ioannidis JPA. Why most published research findings are false. *PLoS Medicine.* 2005;2(8):e124. doi:10.1371/journal.pmed.0020124
- Kidwell MC, Lazarević LB, Baranski E, et al. Badges to acknowledge open practices: A simple, low-cost, effective method for increasing transparency. *PLoS Biology.* 2016;14(5):e1002456. doi:10.1371/journal.pbio.1002456
- Klein G. Performing a project premortem. *Harvard Business Review.* 2007;85(9):18–19. (practitioner)
- Klein RA, Ratliff KA, Vianello M, et al. Investigating variation in replicability: A "Many Labs" replication project. *Social Psychology.* 2014;45(3):142–152. doi:10.1027/1864-9335/a000178
- Klein RA, Vianello M, Hasselman F, et al. Many Labs 2: Investigating variation in replicability across samples and settings. *Advances in Methods and Practices in Psychological Science.* 2018;1(4):443–490. doi:10.1177/2515245918810225
- Kluger AN, DeNisi A. The effects of feedback interventions on performance: A historical review, a meta-analysis, and a preliminary feedback intervention theory. *Psychological Bulletin.* 1996;119(2):254–284. doi:10.1037/0033-2909.119.2.254
- Locke EA, Latham GP. Building a practically useful theory of goal setting and task motivation: A 35-year odyssey. *American Psychologist.* 2002;57(9):705–717. doi:10.1037/0003-066X.57.9.705
- Macnamara BN, Hambrick DZ, Oswald FL. Deliberate practice and performance in music, games, sports, education, and professions: A meta-analysis. *Psychological Science.* 2014;25(8):1608–1618. doi:10.1177/0956797614535810
- Macnamara BN, Maitra M. The role of deliberate practice in expert performance: Revisiting Ericsson, Krampe & Tesch-Römer (1993). *Royal Society Open Science.* 2019;6(8):190327. doi:10.1098/rsos.190327
- Mellers B, Stone ER, Murray T, et al. Identifying and cultivating superforecasters as a method of improving probabilistic predictions. *Perspectives on Psychological Science.* 2015;10(3):267–281. doi:10.1177/1745691615577794
- Mitchell DJ, Russo JE, Pennington N. Back to the future: Temporal perspective in the explanation of events. *Journal of Behavioral Decision Making.* 1989;2(1):25–38. doi:10.1002/bdm.3960020103
- Moher D, Bouter L, Kleinert S, et al. The Hong Kong Principles for assessing researchers: Fostering research integrity. *PLoS Biology.* 2020;18(7):e3000737. doi:10.1371/journal.pbio.3000737
- Moshontz H, Campbell L, Ebersole CR, et al. The Psychological Science Accelerator: Advancing psychology through a distributed collaborative network. *Advances in Methods and Practices in Psychological Science.* 2018;1(4):501–515. doi:10.1177/2515245918797607
- Munafò MR, Nosek BA, Bishop DVM, et al. A manifesto for reproducible science. *Nature Human Behaviour.* 2017;1:0021. doi:10.1038/s41562-016-0021
- Nosek BA, Alter G, Banks GC, et al. Promoting an open research culture. *Science.* 2015;348(6242):1422–1425. doi:10.1126/science.aab2374
- Nosek BA, Ebersole CR, DeHaven AC, Mellor DT. The preregistration revolution. *PNAS.* 2018;115(11):2600–2606. doi:10.1073/pnas.1708274114
- Oliver K, Innvar S, Lorenc T, Woodman J, Thomas J. A systematic review of barriers to and facilitators of the use of evidence by policymakers. *BMC Health Services Research.* 2014;14:2. doi:10.1186/1472-6963-14-2
- Open Science Collaboration. Estimating the reproducibility of psychological science. *Science.* 2015;349(6251):aac4716. doi:10.1126/science.aac4716
- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ.* 2021;372:n71. doi:10.1136/bmj.n71
- Pronovost P, Needham D, Berenholtz S, et al. An intervention to decrease catheter-related bloodstream infections in the ICU. *New England Journal of Medicine.* 2006;355(26):2725–2732. doi:10.1056/NEJMoa061115
- Rousseau DM. Is there such a thing as "evidence-based management"? *Academy of Management Review.* 2006;31(2):256–269. doi:10.5465/amr.2006.20208679
- Sackett DL, Rosenberg WMC, Gray JAM, Haynes RB, Richardson WS. Evidence based medicine: what it is and what it isn't. *BMJ.* 1996;312(7023):71–72. doi:10.1136/bmj.312.7023.71
- Simmons JP, Nelson LD, Simonsohn U. False-positive psychology: Undisclosed flexibility in data collection and analysis allows presenting anything as significant. *Psychological Science.* 2011;22(11):1359–1366. doi:10.1177/0956797611417632
- Tannenbaum SI, Cerasoli CP. Do team and individual debriefs enhance performance? A meta-analysis. *Human Factors.* 2013;55(1):231–245. doi:10.1177/0018720812448394
- Taylor MJ, McNicholas C, Nicolay C, et al. Systematic review of the application of the plan–do–study–act method to improve quality in healthcare. *BMJ Quality & Safety.* 2014;23(4):290–298. doi:10.1136/bmjqs-2013-001862
- Tetlock PE, Gardner D. *Superforecasting: The Art and Science of Prediction.* Crown; 2015. (practitioner synthesis)
- Urbach DR, Govindarajan A, Saskin R, Wilton AS, Baxter NN. Introduction of surgical safety checklists in Ontario, Canada. *New England Journal of Medicine.* 2014;370(11):1029–1038. doi:10.1056/NEJMsa1308261

## Maintenance rules

1. **No citation without a resolvable DOI or a stable URL.** If a source cannot be verified, it is
   practitioner judgment and must be labelled grade D.
2. **Grade the claim, not the journal.** A *Nature* paper can be a single small study; a *BMJ*
   consensus statement can still be a standard rather than an effect estimate.
3. **Record contradictions.** If a new study conflicts with a mapped source, add it to the
   "Contested and conditional findings" section before changing the principle.
4. **Never strengthen a claim in the manifesto without strengthening this map.** The body stays
   short; the audit trail carries the weight.
5. **Keep the composite limit visible.** The absence of a trial for the whole manifesto is a
   permanent caveat, not a temporary gap to be hand-waved away.
