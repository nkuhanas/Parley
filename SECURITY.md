# Security

Parley stores coordination metadata and may reference local files through board artifact namespaces.

## Reporting

Please report security issues privately to the package maintainer rather than opening a public issue with exploit details.

## Security model

- Runtime identity resolution fails closed when ambiguous or unknown.
- Board operations should be scoped to explicit board membership.
- Artifact paths are constrained by configured namespace roots and allowed subpaths.
- Reference namespaces can be searched by Parley tools and may return file excerpts, so configure them narrowly.
- Do not point artifact namespaces at directories containing secrets, private keys, `.env` files, credential caches, or unrelated private documents.
- Secrets should not be stored in Parley board records, artifacts, examples, or docs.
