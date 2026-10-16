# Quartermaster (Kaldigo)

Quartermaster 1.0.0 is a modified version of upstream Quartermaster 0.1.23.
It uses the admin secret saved in Marinara Settings → Advanced → Admin Access
for inventory, wardrobe, connection and artwork requests.

This is a replacement for the official `quartermaster` package, not a second
inventory agent. The package ID, agent ID, routes and storage remain unchanged.
Update through the Kaldigo catalog and restart Marinara; do not uninstall the
old package to update it. Enable Quartermaster under Chat Settings → Agents →
Tracker Agents in a Roleplay chat. See UPSTREAM-README.md for feature details.

The catalog workflow builds this source, hashes its files and publishes its
artifact. Run `npm test` and `npm run build` locally; do not create release ZIPs
or edit generated catalog output by hand.

## Compatibility

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

These checks passed against the local Engine 2.5.0 build. This fork does not
change or revalidate upstream model-generated wardrobe quality or every UI
interaction. Inventory and image transport are the verified scope.
