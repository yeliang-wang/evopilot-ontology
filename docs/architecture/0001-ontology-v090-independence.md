# ADR 0001: Independent Ontology v0.9 and complete DL reasoning

Status: accepted direction by the user-approved v0.9 implementation plan; implementation/acceptance pending.

## Context and alternatives

The 0.8.3 owner has native validation/lifecycle APIs but the parent owns Expert and Host routing. Existing OWL declaration restrictions cannot deliver the newly required complete OWL 2 DL reasoning. Historical test assets are disposable; original projects/credentials/audit are not.

Options: (A) keep parent guidance and bounded declarations (smaller but fails independent/full-reasoning outcome); (B) make LinkML authoritative and translate to reasoner (adds an unneeded translation authority and uncertain expressivity); (C) independent owner service/Expert with RDF/OWL authority and bounded upstream DL engine. Choose C. HermiT/OWLAPI first; engine substitution requires equivalent complete-DL tests and toolchain/packaging review, not scope reduction.

## Decision and replacement scope

Ontology owns its service, Expert, plugin, MCP/CLI, installation, native v2 and formal reasoning. This replaces parent-owned Ontology integration and corrected-v1 declaration-only limitations for NEW v2 assets. It does not modify historical normative bytes, sibling execution/quality authority, historical approval meanings or prior publications. Parent canonical vendor generation remains exclusive for old shared contracts; new owned v2 cannot masquerade as them. Shared consumer changes require explicit versioned public adapters.

## Compatibility, migration and trust

No migration/dual authoring for selected disposable test assets. Consumers must reject unsupported v2 and deleted historical identities explicitly; retained audit cannot be retargeted. P6 exact inventory/reset journal protects original sources/credentials and current installation until cutover acceptance. Test Harness purge remains separate. Host auth/CAS/receipts and service-only writes persist. No remote import fetch, credential borrowing, self-approved domain decisions or formal grades. Java worker introduces distribution/license/resource review. LLM prose is never formal inference.

## Guards and consequences

The versioned Target binds roadmap/plan/matrix/source and exact work scopes; governance checks reject drift. Acceptance explicitly covers standalone Host first use, reasoning, correction/refusal/recovery, cross-owner consumption, preserved records and actual downloaded installation. New cleanup/installation paths remain outside ordinary domain mutation dispatch. Revisit engine choice if standard/resource/packaging evidence fails; do not weaken complete-DL commitment. This decision authorizes no automatic execution/release from a test result.
