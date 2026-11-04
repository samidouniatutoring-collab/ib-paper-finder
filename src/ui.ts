type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Tiny element helper: h("button", { class: "btn", onclick }, "Save") */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "checked" || k === "value" || k === "selected" || k === "disabled") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function toast(message: string, isError = false): void {
  const t = h("div", { class: `toast${isError ? " toast-error" : ""}`, role: "status" }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

export function spinner(label: string): HTMLElement {
  return h("p", { class: "muted", "aria-busy": "true" }, label);
}
