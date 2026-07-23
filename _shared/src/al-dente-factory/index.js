import { FACTORY_KEY, MAJOR_VERSION, READY_EVENT, VERSION } from "./constants.js";
import { createEventBus } from "./events.js";
import { createFetchHub } from "./fetch-hub.js";
import { createExtensionRegistry } from "./extensions.js";
import { notifyFactoryIssue } from "./events.js";
import { createApiClient } from "./api.js";
import { createCommandSurface } from "./commands.js";
import { createGenerationTracker } from "./generation.js";
import { createIdentityService } from "./identity.js";
import { createMessageTracker } from "./messages.js";
import { createOperationTracker } from "./operations.js";
import { createParsersSurface } from "./parsers.js";
import { createRoutesSurface } from "./routes.js";
import { createServiceRegistry } from "./services.js";
import { createSseSurface } from "./sse.js";
import { compareVersions, parseVersion } from "./version.js";
import { createWakeLockController } from "./wake-lock.js";

function createRuntimeState(existingRuntime) {
  const state = existingRuntime?.state && typeof existingRuntime.state === "object" ? existingRuntime.state : {};
  state.createdAt ||= new Date().toISOString();
  state.extensions ||= new Map();
  state.services ||= new Map();
  state.operations ||= new Map();
  state.operationSeq = Number(state.operationSeq || 0);
  state.generationRuns ||= new Map();
  state.generationSeq = Number(state.generationSeq || 0);
  state.fetchInterceptors ||= new Map();
  state.fetchInstalled = state.fetchInstalled === true;
  state.fetchHandler ||= null;
  state.originalFetch ||= null;
  state.commands ||= new Map();
  state.commandsInstalled = state.commandsInstalled === true;
  if (!Array.isArray(state.commandCleanups)) state.commandCleanups = [];
  state.caches ||= {
    chats: new Map(),
    messages: new Map(),
    characters: new Map(),
    personas: new Map(),
  };
  state.caches.chats ||= new Map();
  state.caches.messages ||= new Map();
  state.caches.characters ||= new Map();
  state.caches.personas ||= new Map();
  state.wakeLock ||= null;
  state.wakeLeases ||= new Map();
  state.wakeLeaseSeq = Number(state.wakeLeaseSeq || 0);
  state.wakeListenersInstalled = state.wakeListenersInstalled === true;
  if (!Array.isArray(state.wakeListenerCleanups)) state.wakeListenerCleanups = [];
  state.lastWakeLockError ||= "";
  state.lastWakeLockRequestFailedAt = Number(state.lastWakeLockRequestFailedAt || 0);
  return state;
}

function installAlDenteFactory() {
  const existing = window[FACTORY_KEY];
  const existingRuntime = existing?.__alDenteRuntime;
  const existingVersion = existingRuntime?.version || "";
  const existingMajor = Number(existingRuntime?.majorVersion ?? parseVersion(existingVersion).major);

  if (existingRuntime && existingMajor !== MAJOR_VERSION) {
    notifyFactoryIssue("incompatible-major-version", {
      existingVersion,
      packagedVersion: VERSION,
      message: "Disable older Al Dente extensions and update them to matching factory major versions.",
    });
    window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: { factory: existing, incompatible: true } }));
    return;
  }

  if (existingRuntime && compareVersions(existingVersion, VERSION) >= 0) {
    window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: { factory: existing } }));
    return;
  }

  const state = createRuntimeState(existingRuntime);
  if (existingRuntime && compareVersions(existingVersion, VERSION) < 0) {
    notifyFactoryIssue("upgraded-compatible-runtime", {
      existingVersion,
      packagedVersion: VERSION,
      message: "A newer compatible alDenteFactory runtime replaced the older shared surface.",
    });
  }

  const events = createEventBus();
  const extensionRegistry = createExtensionRegistry(state);
  const services = createServiceRegistry(state);
  const wakeLock = createWakeLockController(state);
  const operations = createOperationTracker(state, wakeLock);
  const parsers = createParsersSurface();
  const api = createApiClient(state);
  const identity = createIdentityService(state, api, parsers);
  const routes = createRoutesSurface();
  const fetch = createFetchHub(state, routes);
  const commands = createCommandSurface(state);
  const sse = createSseSurface();
  const messages = createMessageTracker(state);
  const generation = createGenerationTracker(state, sse, messages);
  const marinara = Object.freeze({
    api,
    commands,
    fetch,
    generation,
    identity,
    messages,
    parsers,
    routes,
    sse,
  });

  const factory = Object.freeze({
    version: VERSION,
    events,
    registerExtension: extensionRegistry.registerExtension,
    listExtensions: extensionRegistry.listExtensions,
    getExtension: extensionRegistry.getExtension,
    openOptions: extensionRegistry.openOptions,
    extensions: Object.freeze(extensionRegistry),
    services,
    operations,
    wakeLock,
    marinara,
    __alDenteRuntime: Object.freeze({
      version: VERSION,
      majorVersion: MAJOR_VERSION,
      createdAt: state.createdAt,
      state,
    }),
  });

  window[FACTORY_KEY] = factory;
  window.dispatchEvent(new CustomEvent(READY_EVENT, { detail: { factory } }));
}

installAlDenteFactory();
