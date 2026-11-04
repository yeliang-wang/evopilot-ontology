# Distribution standards evaluation and user review

This is the user-required P5 prerequisite, named **EvoPilot-ontology 发布版标准符合性 E2E 评测**. Distribution means an isolated installation of the frozen candidate package before publication. Publishing a package to make it testable is not authorized. All original 143 acceptance variants and P0–P6 remain required; source registration stays `NOT_EVALUATED`.

The sequence is: freeze candidate/toolchain/corpus/evaluator → isolated installation → standards evaluation → full report → **stop for explicit user report approval** → original formal product E2E → separate release review → downloaded installation/readback. P1–P4 development checks may continue. Neither those checks nor a previous implementation approval permits entering formal product E2E.

## Frozen scope and provenance

Cover declared RDF 1.1/Turtle 1.1 syntax and graph output, applicable RDF/XML cases, OWL 2 DL Direct Semantics, SHACL Core and supported local SHACL-SPARQL. Complete legal OWL 2 DL remains a product delivery obligation. Old release exclusions cannot reduce it. No authoritative official case means no official score for that capability, while its product acceptance obligation remains.

Before execution, retain each upstream URL, exact specification version, approval status, commit or verifiable snapshot, manifest and all input/expected/dependency file hashes, license, upstream case ID, applicability and rationale. Enumerate and freeze actual cases; this policy contains no asserted upstream counts. Proposed, rejected and locally authored tests cannot enter the official required denominator. Freeze exclusions before seeing results. In-scope failures, missing product output and unavailable tooling cannot be relabeled as out of scope after execution.

Use two views of the same unique upstream IDs: standard families and official complex scenarios. A complex case is not a second score. Product task, combination, business and adversarial tests are separate. L1/L2/L3 are product classifications, not industry grades or weighted scores.

The [OWL 2 conformance specification](https://www.w3.org/TR/owl2-conformance/) defines test kinds and approval metadata and explains why a finite test suite cannot establish complete conformance. The [Turtle test suite](https://w3c.github.io/rdf-tests/rdf/rdf11/rdf-turtle/) supplies manifests, expected results and licensing. Pin the selected snapshot rather than relying on a live page's count.

## Actual product observations and comparisons

Run official inputs through the installed candidate's real public CLI, HTTP or MCP path. Retain actual request, response, installed package identity, operation, timestamps, errors and comparator evidence. Direct HermiT or pySHACL invocation is component diagnosis only. An adapter may supply required envelope metadata, but cannot alter graph meaning, base IRI, imports, constraints, expected answers or product admission rules. No test bypass or fabricated success receipt is allowed.

For Turtle semantic tests compare the graph actually returned by the product with the official expected graph. Reparsing the input with an external parser is not a product observation. An unrelated envelope/admission error cannot pass a negative syntax test. Timeout, crash and missing output remain errors.

For SHACL record boolean conformity and full report comparison independently. Follow the [official comparison procedure](https://w3c.github.io/data-shapes/data-shapes-test-suite/) for permitted normalization, retained predicates, result paths and graph isomorphism. Boolean agreement alone cannot pass the full-report requirement. Comparator implementation and rules are frozen with the evaluator; self-reported product success is not the test oracle.

## Complete report and gate

For every family report `PASS / frozen required count`, FAIL, ERROR, NOT_RUN, and EXCLUDED with the frozen reason. Recompute summaries from unique case results. A zero denominator is unavailable, never 100%. Show official complex scenarios without adding their results again. Publish no weighted total. The project technical threshold is all required cases PASS with complete provenance, observations and comparisons; missing family coverage, ERROR or NOT_RUN blocks the gate.

The complete human-readable report must include candidate/version/configuration identities, frozen scope and exclusions, source and license inventory, both views, SHACL's two outcomes, all failures and limitations, and links to immutable raw evidence. Its bytes are part of the machine report binding. The permitted claim is “this distribution passed the listed standards-conformance corpus under the listed versions, scope and configuration.” This threshold is an EvoPilot project requirement, not W3C certification or proof of complete OWL 2 DL conformance.

Even after technical success, present the complete report and wait. A user rejection or change request blocks progression. Silence, automatic PASS, an agent conclusion or earlier implementation authority cannot approve the report. Bind the actual user decision to candidate package, corpus, toolchain/configuration and report hashes; also bind the freeze and current Target to prevent governance drift. Any changed basis requires reevaluation and a new review. Review grants only entry to the original formal product E2E; product acceptance and release approval remain separate.

## Executable evidence contract

`node scripts/formal-e2e.mjs --evidence ABS_PRIVATE_DIR --request RELATIVE_JSON` is the read-only formal-entry preflight. It verifies governance, current requested artifacts, the frozen corpus, the complete report and the latest user decision. It returns `ALLOW_PRODUCT_E2E` only for the exact approved basis, otherwise exits nonzero. It does not run collectors, write an approval, publish or install. Formal collectors and the eventual P5 release evaluator must require this admission for the same candidate, and must record its bindings and start after the review. Their complete implementation remains part of the original P5 work; this preflight alone is not formal product acceptance.

The private evidence directory contains `freeze.json`, `report.json`, `review-ledger.json` when a real review exists, and referenced regular files. All paths are relative within a canonical private evidence root outside the source checkout. References carry SHA-256 hashes. Public source contains the policy and verifier, never real user decisions, private credentials or business materials.

The freeze binds the current Target/policy, actual candidate archive, toolchain/configuration inventory, corpus and evaluator inventory. The corpus identifies approved upstream cases and all referenced files. Upstream IDs are canonical full identifiers, unique across source aliases and both report views. The report binds the freeze and retains unique per-case observations and independent comparison records. Full report bytes, exclusions, family summaries and the complex view are verified. The review ledger is ordered and hash-chained: the latest retained decision determines the result. The operator must verify that it includes the latest actual user decision; hashing a supplied JSON ledger cannot prove that an external conversation has no later decision or that the ledger was not truncated.

A retained source record must identify an actual user message, its text, conversation/turn/message IDs, explicit action, timestamp and exact reviewed bindings. The verifier checks retained records and hashes; it cannot authenticate an external conversation merely from JSON. The operating agent must retrieve and verify the actual user message through the trusted Host before recording a decision. No CLI creates or infers approval. Test-only synthetic review records are explicitly labeled fixtures and cannot be used for real acceptance.

Run verifier tests with `node --test tests/governance/standards-gate.test.mjs`. These test refusal/allow behavior with synthetic evidence; they are not official standards evaluations. Actual upstream freezing, installed-product comparators, the full candidate report and user report approval remain pending until their real evidence exists.
