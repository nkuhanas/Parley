# Machine board examples

This directory contains non-mutating examples for the `parley.machine-board.v0` and `parley.node-manifest.v0` contracts.

## node-main

`node-main/node-manifest.example.json` is a secret-free node manifest fixture.

`node-main/proxmox-inventory.example.json` is a normalized Proxmox-shaped inventory snapshot fixture. `node-main/proxmox-cluster-resources.example.json` mirrors the read-only `/cluster/resources` response shape accepted by the Proxmox adapter boundary. Both are static test data only; they do not call Proxmox and do not require a token.

The inventory importer maps Proxmox resources into generic machine-board object kinds and preserves Proxmox details only in provider metadata. The read-only adapter boundary accepts an injected request function, issues only a `GET /cluster/resources` request descriptor, and normalizes the response into `inventory_observed` machine-board effect intents with deterministic ids. It does not create tokens, store secrets, write back to Proxmox, or mutate infrastructure.
