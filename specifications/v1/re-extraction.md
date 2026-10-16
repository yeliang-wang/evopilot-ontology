# Source-based re-extraction

1. Preserve historical assets, decisions, receipts and source revisions byte-for-byte.
2. Independently inventory authorized source or design requirements; separate facts and inferred interpretations.
3. Fix expected identities, shapes and cases before authoring; do not derive completeness from the generated model.
4. Create native Turtle/SHACL in a new asset content version with corrected-v1 digests.
5. Execute real native checks, review exact evidence and record the actual domain decision before publication.
6. Compare historical assets afterward to explain differences. Conversion alone is not extraction or acceptance.

Old JSON mutation operations reject new work. Native writes mark state schema 2 so old clients requiring schema 1 cannot silently read new data. Rollback restores a coherent old snapshot and keeps new work separately.
