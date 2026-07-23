import { emit } from "./events.js";
import { normalizeId, toCleanString } from "./strings.js";

function publicServiceRecord(record) {
  return {
    id: record.id,
    version: record.version,
    owner: record.owner,
    registeredAt: record.registeredAt,
    updatedAt: record.updatedAt,
    capabilities: [...record.capabilities],
  };
}

export function createServiceRegistry(state) {
  function register(id, service, options = {}) {
    const serviceId = normalizeId(id, "");
    if (!serviceId) throw new Error("alDenteFactory.services.register requires an id.");
    if (service == null) throw new Error(`alDenteFactory service "${serviceId}" cannot be null.`);

    const now = new Date().toISOString();
    const existing = state.services.get(serviceId);
    const record = {
      id: serviceId,
      service,
      owner: toCleanString(options.owner, existing?.owner || ""),
      version: toCleanString(options.version, existing?.version || ""),
      capabilities: new Set(Array.isArray(options.capabilities) ? options.capabilities.map(String) : existing?.capabilities || []),
      registeredAt: existing?.registeredAt || now,
      updatedAt: now,
    };

    state.services.set(serviceId, record);
    emit("service-registered", { service: publicServiceRecord(record) });

    return Object.freeze({
      id: serviceId,
      unregister: () => unregister(serviceId, service),
      update: (nextService, nextOptions = {}) => register(serviceId, nextService, { ...options, ...nextOptions }),
    });
  }

  function unregister(id, expectedService) {
    const serviceId = normalizeId(id, "");
    const record = state.services.get(serviceId);
    if (!record) return false;
    if (expectedService !== undefined && record.service !== expectedService) return false;
    state.services.delete(serviceId);
    emit("service-unregistered", { id: serviceId });
    return true;
  }

  function get(id) {
    return state.services.get(normalizeId(id, ""))?.service || null;
  }

  function getRecord(id) {
    const record = state.services.get(normalizeId(id, ""));
    return record ? publicServiceRecord(record) : null;
  }

  return Object.freeze({
    register,
    unregister,
    get,
    getRecord,
    has: (id) => state.services.has(normalizeId(id, "")),
    list: () => Array.from(state.services.values()).map(publicServiceRecord),
  });
}
