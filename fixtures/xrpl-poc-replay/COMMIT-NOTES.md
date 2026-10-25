# Fixture commit boundary

Gita directly authorized a commit of this E2E fixture scope on 25 October 2026.
This commit includes the files in this folder, excluding ignored private run data.
It contains no wallet seeds, private keys, signed attempt journals or local databases.
It does not include the separate schema, registry, runtime or application patches.

The recorded native results cover the completed harness used for those runs.
The current harness includes a later durable issuer-return integration.
That integration has passed syntax and offline checks. Its fresh native run remains
NOT RUN. The recorded native transactions were not repeated for this commit.

The readable report and public JSON records need no application setup for review.
Rerunning the fixture needs the separate draft registry and schema implementation,
plus its compatible runtime and dependencies. A checkout of this fixture commit alone
does not supply that implementation. `change-manifest.json` records dependency hashes.

The latest pre-commit checks report 37 fixture tests PASS with no skips or TODOs.
Native harness syntax and plan-only execution PASS. Private run files remain ignored.
Native default remains NOT RUN. Its simulated registry accounting test passes.

The public native evidence remains separate from simulated replay inputs.
No push, deployment or teammate message is part of this commit request.
