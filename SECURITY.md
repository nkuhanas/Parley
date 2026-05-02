# Security

Parley stores coordination metadata and may reference local files through board artifact namespaces.

## Reporting

Please report security issues privately to the package maintainer rather than opening a public issue with exploit details.

## Security model

- Runtime identity resolution fails closed when ambiguous or unknown.
- Board operations should be scoped to explicit board membership.
- Artifact paths are constrained by configured namespace roots and allowed subpaths.
- Secrets should not be stored in Parley board records, artifacts, examples, or docs.
