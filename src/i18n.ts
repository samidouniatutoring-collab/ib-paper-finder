export type Lang = "en" | "es";

function initial(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "en" || saved === "es") return saved;
  } catch {
    /* ignore */
  }
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

export let lang: Lang = initial();

export function setLang(l: Lang): void {
  lang = l;
  try {
    localStorage.setItem("lang", l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
}

/** tr("English", "Español") */
export function tr(en: string, es: string): string {
  return lang === "es" ? es : en;
}
