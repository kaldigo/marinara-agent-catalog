# Upstream utility

src/client/thinking-tags.js is Marinara Engine's shared thinking-tags.ts utility,
with TypeScript annotations removed mechanically using Node stripTypeScriptTypes.

Source: Pasta-Devs/Marinara-Engine, commit c56501495
Path: packages/shared/src/utils/thinking-tags.ts
License: GNU Affero General Public License v3.0 (included in LICENSE).
Source repository: https://github.com/Pasta-Devs/Marinara-Engine

This small utility is kept intact to match native reasoning parsing rather than
maintaining an independent tag regex. No Engine runtime or bridge is copied.
