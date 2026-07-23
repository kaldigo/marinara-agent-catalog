const CLIENT_CSS = `
.mari-ib-root {
  display: inline-flex;
  gap: 0.125rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
  -webkit-tap-highlight-color: transparent;
}

.mari-bridge-slot-quick-actions,
.mari-bridge-slot-quick-actions .mari-bridge-slot-contribution {
  display: contents;
}

.mari-bridge-slot-quick-actions .mari-ib-root {
  flex-direction: column;
  gap: 0.375rem;
}

.mari-ib-root,
.mari-ib-root * {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
  -webkit-tap-highlight-color: transparent;
}

.mari-ib-button {
  display: flex;
  height: 2.25rem;
  width: 2.25rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: color-mix(in srgb, currentColor 75%, transparent);
  cursor: pointer;
  touch-action: manipulation;
  transition: all 160ms ease;
}

.mari-bridge-slot-quick-actions .mari-ib-button {
  position: relative;
  height: 2.75rem;
  width: 2.75rem;
  border: 1px solid color-mix(in srgb, var(--foreground, currentColor) 20%, transparent);
  border-radius: 999px;
  background: var(--card, transparent);
  color: color-mix(in srgb, var(--foreground, currentColor) 55%, transparent);
  box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.24), 0 8px 10px -6px rgb(0 0 0 / 0.22);
  outline: none;
  transition-property: color, background-color, border-color, transform;
}

@media (min-width: 640px) {
  .mari-ib-button {
    height: 2rem;
    width: 2rem;
  }

  .mari-bridge-slot-quick-actions .mari-ib-button {
    height: 2.5rem;
    width: 2.5rem;
  }
}

.mari-ib-button:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 10%, transparent);
  color: currentColor;
}

.mari-bridge-slot-quick-actions .mari-ib-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--foreground, currentColor) 10%, var(--card, transparent));
  color: color-mix(in srgb, var(--foreground, currentColor) 80%, transparent);
}

.mari-ib-button:active:not(:disabled) {
  transform: scale(0.9);
}

.mari-bridge-slot-quick-actions .mari-ib-button:active:not(:disabled) {
  transform: scale(0.95);
}

.mari-ib-button:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 20%, transparent);
}

.mari-ib-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  color: color-mix(in srgb, currentColor 25%, transparent);
}

.mari-bridge-slot-quick-actions .mari-ib-button:disabled {
  border-color: color-mix(in srgb, var(--foreground, currentColor) 10%, transparent);
  background: color-mix(in srgb, var(--card, transparent) 75%, transparent);
  opacity: 0.45;
}

.mari-ib-icon-shell {
  display: flex;
  height: 2rem;
  width: 2rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
}

.mari-bridge-slot-quick-actions .mari-ib-icon-shell {
  color: inherit;
  background: color-mix(in srgb, var(--foreground, currentColor) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--foreground, currentColor) 15%, transparent);
  transition: background-color 160ms ease, box-shadow 160ms ease;
}

.mari-bridge-slot-quick-actions .mari-ib-button:hover:not(:disabled) .mari-ib-icon-shell {
  background: transparent;
  box-shadow: inset 0 0 0 1px transparent;
}

.mari-ib-button svg {
  width: 1rem;
  height: 1rem;
  pointer-events: none;
}

.mari-bridge-generation-stop {
  position: relative;
}

.mari-bridge-generation-stop > svg {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  pointer-events: none;
  opacity: 0;
}

.mari-bridge-generation-stop::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1rem;
  height: 1rem;
  transform: translate(-50%, -50%);
  background: currentColor;
  pointer-events: none;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Crect x='9' y='9' width='6' height='6' rx='1'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Crect x='9' y='9' width='6' height='6' rx='1'/%3E%3C/svg%3E") center / contain no-repeat;
}

.mari-ib-toast {
  position: fixed;
  left: 50%;
  bottom: 86px;
  z-index: 99999;
  max-width: min(90vw, 640px);
  transform: translateX(-50%);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  padding: 8px 12px;
  text-align: center;
  font: 700 12px/1.2 system-ui, Segoe UI, Roboto, Helvetica, Arial;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  transition: opacity 220ms ease;
}

.mari-ib-toast-ok {
  background: linear-gradient(135deg, #10b981, #14b8a6);
}

.mari-ib-toast-out {
  opacity: 0;
}
`;
