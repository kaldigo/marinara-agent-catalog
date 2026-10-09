// Engine 2.5.0 QuickReplyMenu.tsx owns these classes (including theme hooks).
// Keep both layers: the outer control and the inner icon's hover/disabled ring.
const CONTROL = "mari-chat-style-control mari-chat-quick-reply group relative flex h-11 w-11 items-center justify-center rounded-full border shadow-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/20 sm:h-10 sm:w-10";
const ICON = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 transition-colors";

export function styleQuickAction(button, reason, label, description) {
  button.disabled = Boolean(reason);
  button.className = CONTROL + " " + (reason
    ? "cursor-not-allowed border-foreground/10 bg-[var(--card)]/75 opacity-45"
    : "border-foreground/20 bg-[var(--card)] text-foreground/55 hover:bg-foreground/10 hover:text-foreground/80 active:scale-95");
  button.firstElementChild.className = ICON + " " + (reason
    ? "bg-foreground/5 text-foreground/40 ring-transparent"
    : "bg-foreground/10 ring-foreground/15 group-hover:bg-transparent group-hover:ring-transparent");
  button.title = label + ": " + (reason || description);
  button.setAttribute("aria-label", label + ": " + description);
}

// These DOM contributions are not React motion children. Follow the native
// rail's actual animated values instead of approximating its spring with CSS.
// Spread contributions across the native stagger phases. The native rail owns
// opening, closing, interrupted animations and removal; we never extend its life.
// Read only the captured menu buttons, only while this popup is mounted.
export function followNativeMotion(nativeButtons, buttons) {
  let frame = 0;
  let stopped = false;
  function update() {
    if (stopped || !buttons[0].isConnected) return;
    const motion = nativeButtons.map(button => {
      const style = getComputedStyle(button);
      return { opacity: style.opacity, transform: style.transform, filter: style.filter };
    });
    buttons.forEach((button, index) => {
      const values = motion[Math.floor(index * motion.length / buttons.length)];
      for (const property of ["opacity", "transform", "filter"]) {
        if (button.style[property] !== values[property]) button.style[property] = values[property];
      }
    });
    frame = requestAnimationFrame(update);
  }
  update();
  return () => { stopped = true; cancelAnimationFrame(frame); };
}
