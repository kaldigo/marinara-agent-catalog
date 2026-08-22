import { activateWithMariBridge } from "../../../_mari-bridge/sdk/server.js";

let state = { active: false, cleaned: 0 };

export async function activate(context) {
  return activateWithMariBridge(
    context,
    {
      consumerId: "mari-bridge-smoke",
      api: { major: 1, minMinor: 0 },
      require: [
        "consumer.sessions",
        "prompt.inject",
        "prompt.suppress",
        "prompt.transform-final",
        "prompt.transform-history",
        "runtime.health",
      ],
    },
    async (session) => {
      session.prompts.suppress({ id: "disabled-probe", identifiers: ["mari_bridge_smoke_never"] });
      session.prompts.inject({
        id: "disabled-probe",
        position: "end",
        role: "system",
        content: "MARI_BRIDGE_SMOKE_SHOULD_NOT_APPEAR",
        when: () => false,
      });
      session.prompts.transform({
        id: "history-identity",
        stage: "history",
        transform: (messages) => messages,
      });
      session.prompts.transform({
        id: "final-identity",
        stage: "final",
        transform: (messages) => messages,
      });
      const cleanupRoutes = await context.api.registerPrivilegedRoutes(
        async (app) => {
          app.get("/status", async () => ({ ...state, bridgeAborted: session.signal.aborted }));
        },
        { prefix: "/api/mari-bridge-smoke" },
      );
      state = { active: true, cleaned: state.cleaned };
      return () => {
        cleanupRoutes();
        state = { active: false, cleaned: state.cleaned + 1 };
      };
    },
  );
}

export async function selfCheck() {
  if (!state.active) throw new Error("Mari Bridge smoke consumer did not activate");
}
