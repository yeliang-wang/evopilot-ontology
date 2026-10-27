# Contributing

Start with the [documentation index](docs/README.md) and the repository source rules. Keep changes scoped to Ontology semantics, owned lifecycle or its compatibility boundary. Coordinate cross-product changes through the [parent contribution workflow](https://github.com/yeliang-wang/evopilot/blob/main/CONTRIBUTING.md).

Use Node 24.14.0 and the committed lockfile:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
node dist/cli.js help
node dist/cli.js version
```

Build compiles owned strict TypeScript 5.9.3 to JavaScript and declarations, copies retained compatibility JavaScript and prepares the CLI. Check validates types, public package type consumers, source boundaries and the pinned vendor contract. Tests cover native contracts, compatibility and durable service behavior. Report the commands actually run and any limitations. Release packages omit development scripts/tests; run this workflow in a source checkout.

Preserve frozen native v1 schemas/templates, historical schema IDs, compatibility bytes, provenance and licenses. Use relative Markdown links for packaged files and full GitHub URLs for other repositories. Document exact API payload, receipt and trust boundaries.

Use commits attributed to your own GitHub account: configure a GitHub-verified email or your account's GitHub noreply address. Do not fabricate identities or rewrite historical v0.1.0 attribution. Include the concrete behavior change and actual validation in pull requests.

The parent records exact child commits as gitlinks. Complete child review and checks, then update the parent gitlink to that exact reviewed commit through the [parent workflow](https://github.com/yeliang-wang/evopilot/blob/main/CONTRIBUTING.md); do not substitute a branch name or an uncommitted working tree. See [release mechanics](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md) for source-revision and artifact binding. Publication requires applicable acceptance and explicit release authorization.

## Documentation consistency

`npm run check` includes `scripts/check-documentation.mjs`. Keep the README, documentation index, current changelog section and default installation examples aligned with `package.json`; retain explicitly historical version records. Run `node --test tests/e2e/documentation.test.mjs` for the gate regression cases. Source documentation updates do not replace existing tags or release archives.

## Bilingual entry points

Update `README.md` and `README_CN.md` together when changing behavior descriptions, versions, prerequisites, commands or limits. Follow [bilingual maintenance](docs/documentation-languages.md) ([简体中文](docs/zh-CN/documentation-languages.md)). `npm run check` runs the synchronization guard; semantic translation review remains required. Include available Chinese pages in future packages without replacing historical releases.
