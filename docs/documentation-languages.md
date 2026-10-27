# Bilingual documentation maintenance

English | [简体中文](zh-CN/documentation-languages.md)

This policy covers the English `README.md`, Simplified Chinese `README_CN.md` and translated entry guides. It changes documentation maintenance, not product behavior or the meaning of an asset grade.

## Paired entry points

Keep English as the default README and provide reciprocal language links near the top. Match the section order, capability claims, prerequisites, commands, examples, versions and limitations. Translate prose naturally; do not translate API names, keys, identifiers, filenames or executable code. Chinese cross-product navigation should use each product's Chinese README. Label an untranslated destination “英文”.

Use `docs/zh-CN/` for Chinese guides. Link each guide to its corresponding English source and back to the Chinese index. The index must distinguish available translations from English-only references. APIs, schemas, accepted contracts and verified implementation determine behavior; a translation never creates a second product specification.

## Update and review together

When changing capabilities, versions, commands or limits, update the paired pages in the same change. Compare the meaning as well as the syntax. In particular, preserve explicit v2 L1/L2/L3 content semantics, the separation of `assetAssessment` and `reconstructionVerification`, and the validity of `L3 / NOT_REQUESTED`. Do not translate a content grade into a claim of verified software equivalence.

Review the installation prerequisites, expected result, recovery route, source/release distinction and every capability qualification in both languages. Maintain equivalent examples and use the exact same command/code blocks in paired READMEs. The Chinese installation guide also shares the English command blocks.

Run the repository's existing documentation check:

```sh
node scripts/check-documentation.mjs
git diff --check
```

The bilingual guard checks reciprocal links, versions, distribution names, code/technical-token parity and local links/anchors in bilingual entry pages. It does not certify semantic equivalence; the prose review is still required. The parent additionally checks the Chinese installation commands and v2 facet/closure coverage.

## Distribution

Include both READMEs and available guides in future source-built packages and parent bundles. Verify their presence and offline links in a candidate distribution. Source pages may advance after a release; do not replace published tags, release archives, installed program files or asset snapshots to add translations. A source documentation change is not a new software-release or daily-cutover decision.
