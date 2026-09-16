const BRIDGE = 'globalThis[Symbol.for("marinara.mari-bridge.client.v1")]';
const ID = "[A-Za-z_$][\\w$]*";
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function one(source, expression, label) {
  const matches = [...source.matchAll(new RegExp(expression, "gu"))];
  if (matches.length !== 1) throw new Error(`Mari Bridge ${label} expected one site, found ${matches.length}`);
  return matches[0];
}

// Discover locals from native prop names and JSX contracts, never minifier IDs.
// The enclosing function remains version-bound and every insertion is counted.
export function patchTrackerDetails(source, { findMatchingDelimiter, findNamedImportAlias }) {
  if (!source.includes("ui.trackerPanel.charactertrackercard.outfit")) return null;
  function component(required, marker, transform) {
    const matches = [...source.matchAll(new RegExp(`function (?<name>${ID})\\(\\{(?<params>[^{}]+)\\}\\)\\{`, "gu"))]
      .map((match) => {
        const props = Object.fromEntries(match.groups.params.split(",").map((part) => part.split(":")).map(([key, value]) => [key, value?.split("=")[0]]));
        if (!required.every((key) => props[key])) return null;
        const start = match.index + match[0].length - 1;
        const end = findMatchingDelimiter(source, start, "{", "}") + 1;
        const body = source.slice(start, end);
        return body.includes(marker) ? { match, props, start, end, body } : null;
      }).filter(Boolean);
    if (matches.length !== 1) throw new Error(`Mari Bridge tracker component ${required.join("/")} expected one match, found ${matches.length}`);
    const item = matches[0];
    const result = transform(item.body, item.props, item.match.groups.name);
    const header = result.extraProps
      ? item.match[0].replace("}){", `,${result.extraProps}}){`)
      : item.match[0];
    source = source.slice(0, item.match.index) + header.slice(0, -1) + result.body + source.slice(item.end);
    return item.match.groups.name;
  }

  const react = findNamedImportAlias(source, "vendor-react-", "r");
  source = source.replace(/Array\.isArray\((?<stats>[A-Za-z_$][\w$]*\.(?:stats|personaStats))\)\?\k<stats>:\[\]/gu,
    (...args) => {
      const stats = args.at(-1).stats;
      const method = stats.endsWith(".personaStats") ? "filterPersonaTrackerStats" : "filterCharacterTrackerStats";
      return `(${BRIDGE}?.${method}(${stats})??(Array.isArray(${stats})?${stats}:[]))`;
    });

  function filterCustomFields(body, character) {
    const match = one(body, `Object\\.entries\\(${escape(character)}\\.customFields\\?\\?\\{\\}\\)`, "character detail filter");
    return body.replace(match[0], `(${BRIDGE}?.filterCharacterTrackerDetailFields(${character}.customFields)??${match[0]})`);
  }
  function removeField(body, character) {
    return one(body, `(?<remove>${ID})=(?<key>${ID})=>\\{const (?<fields>${ID})=\\{\\.\\.\\.${escape(character)}\\.customFields\\?\\?\\{\\}\\};delete \\k<fields>\\[\\k<key>\\]`, "native custom-field removal").groups.remove;
  }

  component(["character", "characterPicture", "onUpdate", "characterIndex", "deleteMode", "addMode"], "ui.trackerPanel.charactertrackercard.outfit", (body, props) => {
    const field = one(body, `(?<jsx>${ID})\\.jsx\\((?<field>${ID}),\\{icon:\\k<jsx>\\.jsx\\(${ID},\\{size:"[^"]+"\\}\\),accessibleLabel:"Outfit",`, "native compact Outfit field").groups;
    const density = one(body, `(?<density>${ID})=${ID}\\.length>0\\|\\|${ID}\\.length>0\\|\\|${escape(props.addMode)},(?<readable>${ID})=\\k<density>`, "compact density");
    const removal = removeField(body, props.character);
    const extra = `${BRIDGE}?.hasCharacterTrackerDetailFields(${props.character}.customFields)===!0`;
    body = body.replace(density[0], density[0].replace(`,${density.groups.readable}=`, `||${extra},${density.groups.readable}=`));
    const fieldsRoot = one(body, `(?<guard>${ID})&&${escape(field.jsx)}\\.jsxs\\("div",\\{className:${ID},children:\\[(?=[\\s\\S]*?accessibleLabel:"Mood")`, "compact native field container");
    body = body.replace(fieldsRoot[0], fieldsRoot[0].replace(`${fieldsRoot.groups.guard}&&`, `(${fieldsRoot.groups.guard}||${extra})&&`));
    const tail = one(body, `onToggleHidden:\\(\\)=>${ID}\\("outfit"\\)\\}\\)\\]\\}\\)`, "compact Outfit tail");
    const addition = `${BRIDGE}?.renderCompactCharacterTrackerDetailFields({jsx:${field.jsx},native:{Field:${field.field}},character:${props.character},characterIndex:${props.characterIndex},onUpdate:${props.onUpdate},onRemove:${removal},deleteMode:${props.deleteMode},readable:${density.groups.readable}})??[]`;
    body = body.replace(tail[0], tail[0].slice(0, -3) + `,...(${addition})]})`);
    return { body: filterCustomFields(body, props.character) };
  });

  const featuredFields = component(["character", "onUpdate", "sizeProfile", "characterIndex"], 'key:"outfit"', (body, props) => {
    const tail = one(body, `value:${escape(props.character)}\\.outfit\\}\\]\\.filter`, "featured field descriptors");
    const rows = one(body, `children:(?<rows>${ID})\\.map\\((?<row>${ID})=>(?<jsx>${ID})\\.jsx\\((?<tile>${ID}),\\{(?<props>[^{}]+)\\},\\k<row>\\.key\\)\\)`, "featured native field renderer").groups;
    body = body.replace(tail[0], `value:${props.character}.outfit},...(${BRIDGE}?.resolveFeaturedCharacterTrackerDetailFields({jsx:${rows.jsx},character:${props.character},characterIndex:${props.characterIndex},onUpdate:${props.onUpdate},onRemove:mariBridgeOnRemove})??[])].filter`);
    const row = rows.row;
    const key = one(rows.props, `lockKey:(?<key>${ID})\\(${escape(row)}\\.key\\)`, "featured lock key").groups.key;
    const hidden = one(rows.props, `hideMode:(?<mode>${ID})`, "featured hide mode").groups.mode;
    const toggle = one(rows.props, `onToggleHidden:\\(\\)=>(?<toggle>${ID})\\(${escape(row)}\\.key\\)`, "featured hide callback").groups.toggle;
    const tileProps = rows.props
      .replace(`fieldKey:${row}.key`, `fieldKey:${row}.mariBridgeOnRemove?"outfit":${row}.key`)
      .replace(`lockKey:${key}(${row}.key)`, `lockKey:${row}.mariBridgeOnRemove?${row}.lockKey:${key}(${row}.key)`)
      .replace(`hidden:${row}.hidden`, `hidden:${row}.mariBridgeOnRemove?!1:${row}.hidden`)
      .replace(`hideMode:${hidden}`, `hideMode:${row}.mariBridgeOnRemove?!1:${hidden}`)
      .replace(`onToggleHidden:()=>${toggle}(${row}.key)`, `onToggleHidden:${row}.mariBridgeOnRemove?()=>{}:()=>${toggle}(${row}.key)`);
    const tile = `${rows.jsx}.jsx(${rows.tile},{${tileProps}},${row}.key)`;
    const removable = `${rows.jsx}.jsxs("div",{className:"relative grid h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden",children:[${tile},${rows.jsx}.jsx("button",{type:"button",onClick:${row}.mariBridgeOnRemove,title:\`Remove \${${row}.accessibleLabel}\`,"aria-label":\`Remove \${${row}.accessibleLabel}\`,className:"absolute right-0.5 top-1/2 z-[3] flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-[var(--destructive)] hover:bg-[var(--destructive)]/10 focus-visible:ring-1 focus-visible:ring-[var(--border)]",children:"×"})]},${row}.key)`;
    const original = `children:${rows.rows}.map(${row}=>${rows.jsx}.jsx(${rows.tile},{${rows.props}},${row}.key))`;
    body = body.replace(original, `children:${rows.rows}.map(${row}=>${row}.mariBridgeOnRemove&&mariBridgeDeleteMode?${removable}:${tile})`);
    return { body, extraProps: "mariBridgeDeleteMode:mariBridgeDeleteMode,mariBridgeOnRemove:mariBridgeOnRemove" };
  });

  component(["character", "onUpdate", "characterIndex", "deleteMode", "dockedThoughtsAlwaysVisible"], `.jsx(${featuredFields},`, (body, props) => {
    const call = one(body, `\\.jsx\\(${escape(featuredFields)},\\{character:${ID},onUpdate:${ID},sizeProfile:${ID},characterIndex:${ID}\\}\\)`, "featured field call");
    body = body.replace(call[0], call[0].slice(0, -2) + `,mariBridgeDeleteMode:${props.deleteMode},mariBridgeOnRemove:${removeField(body, props.character)}})`);
    return { body: filterCustomFields(body, props.character) };
  });

  const persona = component(["persona", "status", "personaStats", "onSaveStatus", "deleteMode", "queuePersonaPortraitSave"], "onToggleFieldLock:", (body, props) => {
    const locks = one(body, `\\{fieldLocks:(?<locks>${ID}),lockMode:(?<mode>${ID}),onToggleFieldLock:(?<toggle>${ID})\\}=(?<hook>${ID})\\(\\)`, "persona locks");
    body = body.replace(locks[0], locks[0].replace("}=", ",onUpdateFieldLocks:mariBridgeUpdateFieldLocks}="));
    const render = one(body, `(?<jsx>${ID})\\.jsx\\("div",\\{className:${ID}\\(${ID},${ID},${ID}\\[${ID}\\],${ID}\\[${ID}\\]\\),children:(?<render>${ID})\\(\\)\\}\\)`, "persona status container");
    const inline = one(body, `\\.jsx\\((?<inline>${ID}),\\{value:${escape(props.status)},onSave:${escape(props.onSaveStatus)},`, "persona native inline editor").groups.inline;
    body = body.replace(render[0], render[0].replace(`children:${render.groups.render}()`, `children:[${BRIDGE}?.shouldShowTrackerContent("persona-status",{surface:"dock"})!==!1?${render.groups.render}():null,...(${BRIDGE}?.renderPersonaTrackerDetailFields({jsx:${render.groups.jsx},native:{InlineEdit:${inline}},fields:mariBridgeFields,onUpdateFields:mariBridgeOnUpdateFields,deleteMode:${props.deleteMode},fieldLocks:${locks.groups.locks},lockMode:${locks.groups.mode},onToggleFieldLock:${locks.groups.toggle},onUpdateFieldLocks:mariBridgeUpdateFieldLocks})??[])]`));
    return { body, extraProps: "mariBridgeFields:mariBridgeFields,mariBridgeOnUpdateFields:mariBridgeOnUpdateFields" };
  });

  component(["activeChatId", "patchPlayerStats", "beforeCustomSections", "afterCustomSections"], ".customTrackerFields", (body, props) => {
    const fields = one(body, `(?<fields>${ID})=Array\\.isArray\\((?<stats>${ID})\\?\\.customTrackerFields\\)\\?\\k<stats>\\.customTrackerFields:\\[\\]`, "persona fields in section list");
    body = body.replace(fields[0], `mariBridgePersonaFields=Array.isArray(${fields.groups.stats}?.customTrackerFields)?${fields.groups.stats}.customTrackerFields:[],${fields.groups.fields}=${BRIDGE}?.filterPersonaTrackerDetailFields(mariBridgePersonaFields)??mariBridgePersonaFields`);
    const call = one(body, `\\.jsx\\(${escape(persona)},\\{[^{}]+?flushPersonaPortraitSave:${ID},`, "persona detail props");
    body = body.replace(call[0], `${call[0]}mariBridgeFields:mariBridgePersonaFields,mariBridgeOnUpdateFields:mariBridgeNextFields=>${props.patchPlayerStats}("customTrackerFields",mariBridgeNextFields),`);
    return { body: `{${BRIDGE}?.useTrackerDetailFields(${react});${body.slice(1)}` };
  });
  return source;
}
