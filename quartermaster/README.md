# Quartermaster (Kaldigo)

Retired from the custom catalog on 2026-10-21 (`includeInMain: false`). Official
Quartermaster now includes the authentication fix; this source is retained for
reference and regression comparison. Future catalog builds use the official
upstream package instead of this fork.

Quartermaster 1.0.0 is a modified version of upstream Quartermaster 0.1.23.
It uses the admin secret saved in Marinara Settings → Advanced → Admin Access
for inventory, wardrobe, connection and artwork requests.

This is a replacement for the official `quartermaster` package, not a second
inventory agent. The package ID, agent ID, routes and storage remain unchanged.
Preserve existing inventory data when replacing it with the official package.
Enable Quartermaster under Chat Settings → Agents →
Tracker Agents in a Roleplay chat. See UPSTREAM-README.md for feature details.

The catalog workflow excludes this source. Run `npm test` and `npm run build`
locally for historical comparisons; do not create release ZIPs or edit generated
catalog output by hand.

## Compatibility

Upstream Quartermaster 0.1.24 added the Admin Secret and authenticated-image
fixes this fork supplied; 0.1.25 added image caching and retry recovery. Current
upstream is 0.1.28. The authentication fix no longer requires a separate fork.
Use `npm run test:host -- --upstream` with the shared testbench lease to exercise
the upstream reference package against the maintained Engine build. This check
uses isolated data and does not replace an existing installation.

Its 1.0.0 version sorts above upstream 0.1.28, so switching back needs an explicit
package replacement; do not assume the normal update check will offer it. Keep
the `quartermaster` identity and inventory data when switching.

The fork retains upstream's capability API 1.14 and Engine compatibility range.
Browser authentication follows Engine's `marinara_admin_secret` storage key and
`x-marinara-csrf: 1` header. These are internal host contracts, so check them when
upgrading Engine. The upstream runtime and UI remain otherwise unchanged.

Source and license attribution are in THIRD-PARTY.md and LICENSE.

## Verification

`npm test` covers authenticated CRUD requests, live secret changes, missing or
blocked storage, protected images, stale image responses, and upstream modal
and state lifecycle regressions (12 checks).

In the Marinara workspace, acquire the shared harness lease, set its printed
token as `HARNESS_LOCK_TOKEN`, then run `npm run test:host`. This uses isolated
fixture data, the maintained Engine build and headless Chrome. It enforces the
admin secret on localhost and checks real CRUD, reload persistence, image
upload/read/delete, outfits, connections, rejection and recovery. The script
stops its browser/server in `finally`; release the lease afterward.

The fork checks passed against the local Engine 2.5.0 build. The same host check
passed for official Quartermaster 0.1.28 on Engine 2.5.1 on 2026-10-21, including
authenticated inventory, slot/item/outfit images, reload and wrong-secret recovery.
The custom authentication fix is therefore no longer needed. This fork does not
change or revalidate upstream model-generated wardrobe quality or every UI
interaction. Inventory and image transport are the verified scope.
