const TARGETS = new Set(["character", "persona"]);

const PERSONA_DETAIL_FIELD_CLASS =
  "relative mx-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden rounded-[5px] border border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_42%,transparent)] bg-[image:var(--tracker-profile-field-material)] px-1.5 py-[0.1875rem] text-[0.6875rem] leading-[0.875rem] shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--background)_34%,transparent)] [background-blend-mode:var(--tracker-profile-field-material-blend)] before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-profile-dialogue-border)_48%,transparent),transparent)] before:opacity-70 before:[mask-image:linear-gradient(90deg,transparent_0%,black_20%,black_78%,transparent_100%)] before:content-['']";

function normalizeName(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function encodeSegment(value) {
  return encodeURIComponent(String(value ?? "").trim() || "_").replace(/\./gu, "%2E");
}

function characterLockKey(character, characterIndex, fieldName, part = "value") {
  const id = typeof character?.characterId === "string" ? character.characterId.trim() : "";
  const name = typeof character?.name === "string" ? character.name.trim() : "";
  const reference = id
    ? `id:${encodeSegment(id)}`
    : name
      ? `name:${encodeSegment(name)}`
      : `index:${Number.isSafeInteger(characterIndex) && characterIndex >= 0 ? characterIndex : 0}`;
  return `characters.${reference}.custom.${encodeSegment(fieldName)}.${part}`;
}

function personaLockKey(fieldName, part = "value") {
  return `player.custom.name:${encodeSegment(fieldName)}.${part}`;
}

function iconElement(jsx, icon, size = "0.75rem") {
  const paths = {
    shirt: ["M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46 2 8l3 1.5V22h14V9.5L22 8z"],
    location: ["M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0", "M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6"],
    movement: ["M4 16v2a2 2 0 0 0 2 2h2", "M8 4H6a2 2 0 0 0-2 2v2", "M16 4h2a2 2 0 0 1 2 2v2", "M16 20h2a2 2 0 0 0 2-2v-2", "m9 15 6-6", "m10 9h5v5"],
    activity: ["M3 12h4l3-8 4 16 3-8h4"],
  };
  return jsx.jsx("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    children: (paths[icon] ?? paths.activity).map((d, index) => jsx.jsx("path", { d }, index)),
  });
}

function removeButton(jsx, name, onRemove) {
  return jsx.jsx("button", {
    type: "button",
    onClick: () => onRemove?.(name),
    title: `Remove ${name}`,
    "aria-label": `Remove ${name}`,
    className: "absolute right-0.5 top-1/2 z-[3] flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border)] active:scale-90",
    children: "×",
  });
}

export function createTrackerDetailFieldRegistry() {
  const registrations = new Map();
  const subscribers = new Set();
  let revision = 0;

  function publish() {
    revision += 1;
    for (const subscriber of [...subscribers]) subscriber();
  }

  function descriptors(target) {
    const claimed = new Set();
    return [...registrations.values()]
      .filter((registration) => registration.target === target)
      .sort((left, right) => right.priority - left.priority || left.ownerId.localeCompare(right.ownerId) || left.id.localeCompare(right.id))
      .flatMap((registration) => registration.fields)
      .filter((field) => {
        const normalized = normalizeName(field.name);
        if (claimed.has(normalized)) return false;
        claimed.add(normalized);
        return true;
      });
  }

  function promotedNames(target) {
    return new Set(descriptors(target).map((field) => normalizeName(field.name)));
  }

  function characterEntries(customFields) {
    const source = customFields && typeof customFields === "object" && !Array.isArray(customFields) ? customFields : {};
    const byName = new Map(Object.entries(source).map(([name, value]) => [normalizeName(name), { name, value: value == null ? "" : String(value) }]));
    return descriptors("character").flatMap((descriptor) => {
      const entry = byName.get(normalizeName(descriptor.name));
      return entry ? [{ ...descriptor, ...entry }] : [];
    });
  }

  function personaEntries(fields) {
    const source = Array.isArray(fields) ? fields : [];
    const byName = new Map();
    source.forEach((field, index) => {
      const normalized = normalizeName(field?.name);
      if (normalized && !byName.has(normalized)) byName.set(normalized, { field, index });
    });
    return descriptors("persona").flatMap((descriptor) => {
      const entry = byName.get(normalizeName(descriptor.name));
      return entry ? [{ ...descriptor, ...entry }] : [];
    });
  }

  return Object.freeze({
    register(ownerId, input = {}) {
      const id = String(input.id ?? "").trim();
      const target = String(input.target ?? "").trim();
      const fields = (input.fields ?? []).map((field) => Object.freeze({
        name: String(field?.name ?? "").trim(),
        icon: String(field?.icon ?? "activity").trim(),
      }));
      if (!id || !TARGETS.has(target) || fields.length === 0 || fields.some((field) => !field.name)) {
        throw new TypeError("Mari Bridge tracker detail fields require id, target, and named fields");
      }
      const normalized = fields.map((field) => normalizeName(field.name));
      if (new Set(normalized).size !== normalized.length) throw new TypeError("Mari Bridge tracker detail field names must be unique");
      const key = `${ownerId}:${id}`;
      if (registrations.has(key)) throw new Error(`Duplicate Mari Bridge tracker detail registration ${key}`);
      const registration = Object.freeze({
        ownerId,
        id,
        target,
        priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
        fields: Object.freeze(fields),
      });
      registrations.set(key, registration);
      publish();
      return () => {
        if (registrations.get(key) === registration) {
          registrations.delete(key);
          publish();
          return true;
        }
        return false;
      };
    },
    filterCharacterFields(customFields) {
      const promoted = promotedNames("character");
      return Object.entries(customFields && typeof customFields === "object" && !Array.isArray(customFields) ? customFields : {})
        .filter(([name]) => !promoted.has(normalizeName(name)))
        .map(([name, value]) => [name, value]);
    },
    hasCharacterFields(customFields) {
      return characterEntries(customFields).length > 0;
    },
    filterPersonaFields(fields) {
      const promoted = promotedNames("persona");
      return (Array.isArray(fields) ? fields : []).filter((field) => !promoted.has(normalizeName(field?.name)));
    },
    renderCompactCharacterFields(input = {}) {
      const { jsx, native, character, characterIndex, onUpdate, onRemove, deleteMode, readable } = input;
      if (!jsx?.jsx || !native?.Field || typeof onUpdate !== "function") return [];
      return characterEntries(character?.customFields).map((entry) => jsx.jsxs("div", {
        className: "relative min-w-0",
        children: [
          jsx.jsx(native.Field, {
            icon: iconElement(jsx, entry.icon, "0.6875rem"),
            accessibleLabel: entry.name,
            value: entry.value,
            placeholder: entry.name,
            onSave: (value) => onUpdate({
              ...character,
              customFields: { ...(character?.customFields ?? {}), [entry.name]: value },
            }),
            tone: "outfit",
            readable: readable === true,
            className: deleteMode ? "pr-5" : undefined,
            lockKey: characterLockKey(character, characterIndex, entry.name),
            onToggleHidden: () => {},
          }),
          deleteMode ? removeButton(jsx, entry.name, onRemove) : null,
        ],
      }, `mari-bridge-character-${normalizeName(entry.name)}`));
    },
    resolveFeaturedCharacterFields(input = {}) {
      const { jsx, character, characterIndex, onUpdate, onRemove } = input;
      if (!jsx?.jsx || typeof onUpdate !== "function") return [];
      return characterEntries(character?.customFields).map((entry) => ({
        accessibleLabel: entry.name,
        icon: iconElement(jsx, entry.icon),
        key: `mari-bridge-${normalizeName(entry.name)}`,
        onSave: (value) => onUpdate({
          ...character,
          customFields: { ...(character?.customFields ?? {}), [entry.name]: value },
        }),
        placeholder: entry.name,
        hidden: false,
        value: entry.value,
        lockKey: characterLockKey(character, characterIndex, entry.name),
        mariBridgeOnRemove: () => onRemove?.(entry.name),
      }));
    },
    renderPersonaFields(input = {}) {
      const { jsx, native, fields, onUpdateFields, deleteMode, fieldLocks, lockMode, onToggleFieldLock, onUpdateFieldLocks } = input;
      if (!jsx?.jsx || !native?.InlineEdit || typeof onUpdateFields !== "function") return [];
      return personaEntries(fields).map((entry) => {
        const lockKey = personaLockKey(entry.name);
        const remove = () => {
          const normalized = normalizeName(entry.name);
          onUpdateFieldLocks?.((locks) => Object.fromEntries(
            Object.entries(locks && typeof locks === "object" ? locks : {}).filter(([key]) => !key.startsWith(`player.custom.name:${encodeSegment(entry.name)}.`)),
          ));
          onUpdateFields((Array.isArray(fields) ? fields : []).filter((field) => normalizeName(field?.name) !== normalized));
        };
        return jsx.jsxs("div", {
          className: PERSONA_DETAIL_FIELD_CLASS,
          children: [
            jsx.jsx("span", {
              className: "relative z-[1] flex h-4 w-4 shrink-0 items-center justify-center text-[color-mix(in_srgb,var(--tracker-profile-accent-solid)_64%,var(--tracker-profile-text)_36%)]",
              title: entry.name,
              "aria-label": entry.name,
              children: iconElement(jsx, entry.icon),
            }),
            jsx.jsx(native.InlineEdit, {
              value: entry.field?.value == null ? "" : String(entry.field.value),
              onSave: (value) => {
                const next = [...(Array.isArray(fields) ? fields : [])];
                next[entry.index] = { ...entry.field, name: entry.name, value };
                onUpdateFields(next);
              },
              placeholder: entry.name,
              title: `${entry.name}: ${entry.field?.value ?? ""}`,
              ariaLabel: entry.name,
              className: `relative z-[1] min-h-5 flex-1 rounded-[2px] px-0.5 py-0 font-medium leading-[0.875rem] text-[color-mix(in_srgb,var(--tracker-profile-text)_92%,var(--muted-foreground)_8%)] hover:bg-[var(--accent)]/18${deleteMode ? " pr-5" : ""}`,
              previewLineCount: 3,
              showEditHint: false,
              locked: fieldLocks?.[lockKey] === true || entry.field?.locked === true,
              lockMode: lockMode === true,
              onToggleLock: () => onToggleFieldLock?.(lockKey),
            }),
            deleteMode ? removeButton(jsx, entry.name, remove) : null,
          ],
        }, `mari-bridge-persona-${normalizeName(entry.name)}`);
      });
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    getVersion() {
      return revision;
    },
    snapshot(target) {
      return descriptors(target).map((field) => ({ ...field }));
    },
  });
}

export const __test = Object.freeze({ normalizeName, characterLockKey, personaLockKey });
