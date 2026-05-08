# Machine board examples

This directory contains non-mutating examples for the `parley.machine-board.v0` and `parley.node-manifest.v0` contracts.

## node-main

`node-main/node-manifest.example.json` is a secret-free node manifest fixture.

`node-main/proxmox-inventory.example.json` is a Proxmox-shaped inventory snapshot fixture. It is static test data only; it does not call Proxmox and does not require a token.

The inventory importer normalizes this snapshot into `inventory_observed` machine-board effect intents with deterministic ids. The importer is observe-only and must not be treated as infrastructure mutation authority.
