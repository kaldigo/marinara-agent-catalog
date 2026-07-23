import { emit } from "./events.js";
import { normalizeId, toCleanString } from "./strings.js";

function publicExtensionRecord(record) {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    capabilities: [...record.capabilities],
    registeredAt: record.registeredAt,
    updatedAt: record.updatedAt,
  };
}

export function createExtensionRegistry(state) {
  function registerExtension(definition = {}) {
    const id = normalizeId(definition.id, definition.name || "");
    if (!id) throw new Error("alDenteFactory.registerExtension requires an id or name.");

    const now = new Date().toISOString();
    const existingRecord = state.extensions.get(id);
    const record = {
      id,
      name: toCleanString(definition.name, existingRecord?.name || id),
      version: toCleanString(definition.version, existingRecord?.version || ""),
      capabilities: new Set(Array.isArray(definition.capabilities) ? definition.capabilities.map(String) : existingRecord?.capabilities || []),
      openOptions: typeof definition.openOptions === "function" ? definition.openOptions : existingRecord?.openOptions || null,
      registeredAt: existingRecord?.registeredAt || now,
      updatedAt: now,
    };

    state.extensions.set(id, record);
    emit("extension-registered", { extension: publicExtensionRecord(record) });

    return Object.freeze({
      id,
      update: (patch = {}) => registerExtension({ ...definition, ...patch, id }),
      unregister: () => {
        const current = state.extensions.get(id);
        if (current !== record) return false;
        state.extensions.delete(id);
        emit("extension-unregistered", { id });
        return true;
      },
      openOptions: (context = {}) => openOptions(id, context),
    });
  }

  function listExtensions() {
    return Array.from(state.extensions.values()).map(publicExtensionRecord);
  }

  function getExtension(id) {
    const record = state.extensions.get(normalizeId(id, ""));
    return record ? publicExtensionRecord(record) : null;
  }

  function openOptions(id, context = {}) {
    const extensionId = normalizeId(id, "");
    const record = state.extensions.get(extensionId);
    if (!record) return false;

    emit("open-options", { id: extensionId, context });
    if (typeof record.openOptions !== "function") return false;
    record.openOptions(context);
    return true;
  }

  return {
    registerExtension,
    listExtensions,
    getExtension,
    openOptions,
  };
}
