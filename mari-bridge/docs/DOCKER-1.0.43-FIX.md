# Docker startup correction in Bridge 1.0.43

The 1.0.42 restart path assumed every Engine 2.4.6 distribution contained
`scripts/run-server.mjs`. The official Docker image ships a different launcher,
`/usr/local/bin/marinara-docker-entrypoint.mjs`, which starts the server directly.
The Bridge closed Fastify before trying to read the missing local supervisor,
leaving the container process present but its server unavailable.

Version 1.0.43 uses direct `execve` for Docker installation and updates. It keeps
the same server PID and official entrypoint parent; Engine's native admin restart
still exits the container normally. Local supervisor behavior remains unchanged.
The preload skips both launchers, and all launch-file checks finish before the
running app closes. A missing file therefore leaves the current app open.

## Verification

[The Linux/Docker validation run passed](https://github.com/kaldigo/marinara-agent-catalog/actions/runs/35091334197)
against source commit `cafea1ab0989ce6c52d060779f8e4079f6342603`:

- All 11 Bridge, SDK and consumer checks on Node 24/Linux; local Windows checks
  also passed.
- Real Linux process replacement under both native launchers, including forced
  updates, app close, server PID/parent ownership and same-process overlays.
- The official `ghcr.io/pasta-devs/marinara-engine:2.4.6` image, explicitly checked
  to have no `/app/scripts/run-server.mjs`.
- First startup without any preload configuration, including server consumer
  activation and native installed-package readiness.
- Native admin restart, container recovery and persisted chat data.
- Cold startup with `NODE_OPTIONS` applied to the official Docker entrypoint.
- A running 1.0.42 preload upgrading to 1.0.43.
- Missing supervisor, native entry or preload failures leave the app open.

The package publication workflow now requires this Linux/Docker suite to pass
before rebuilding the catalog. This extends the earlier Windows integration
record; physical PWA devices and real model providers remain outside these tests.

See [BOOTSTRAP.md](BOOTSTRAP.md#recovery-from-1042-in-docker) for the temporary
startup override if the broken release prevents access to package updates.
If native activation rolled consumers back during the failure, restore their
current verified package versions as well as updating Bridge. Back up the
installed registry before offline repair, keep the container stopped throughout,
and preserve unrelated packages and application data.
