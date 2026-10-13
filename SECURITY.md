# Security boundary

Ontology is a local, single-OS-uid service. Use a private canonical workspace outside source/Git trees, with an existing parent. The service checks identity, ownership, modes, symlinks and product files; directories use 0700 and files 0600. Public/private project scopes constrain service reads and writes. This does not isolate hostile processes running as the same uid or independently authenticate multiple users.

Requests are closed, bounded, descriptor-safe JSON. Source documents cannot supply executable callbacks, credentials or authority. Human evidence references record a local operator decision; they are not an independent identity system. Models, digests, schema checks and historical approval labels do not establish business meaning or current approval.

Classification and foreign Catalog resolvers are trusted SDK-injected application callbacks. Their implementer owns authorization of source access and external model connections. The standalone CLI accepts no provider JSON or ambient Host credentials. Keep private sources, credentials and callback configuration out of public issues, logs and fixtures.

Retain exact request IDs and receipts after uncertain results. Inspect existing evidence before any new submission; never replay UNKNOWN classification work or delete/recreate corrupt state to hide a failure. See the precise [service](docs/service.md), [classification](docs/classification-service.md) and [Catalog](docs/catalog-service.md) contracts.

For reporting guidance, use the [parent security policy](https://github.com/yeliang-wang/evopilot/blob/main/SECURITY.md). Share only a minimal synthetic reproduction in public; never include secrets or private workspace data. This repository specifies no separate security email address.
