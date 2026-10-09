# Upstream utility

src/client/thinking-tags.js is Marinara Engine's shared thinking-tags.ts utility,
with TypeScript annotations removed mechanically using Node stripTypeScriptTypes.

Source: Pasta-Devs/Marinara-Engine, commit c56501495
Path: packages/shared/src/utils/thinking-tags.ts
License: GNU Affero General Public License v3.0 (included in LICENSE).
Source repository: https://github.com/Pasta-Devs/Marinara-Engine

This small utility is kept intact to match native reasoning parsing rather than
maintaining an independent tag regex. No Engine runtime or bridge is copied.

src/client/quick-actions.js uses the control and icon class strings from
packages/client/src/components/chat/QuickReplyMenu.tsx at the same revision and
under the same license, preserving native theme, focus, hover and disabled styles.
