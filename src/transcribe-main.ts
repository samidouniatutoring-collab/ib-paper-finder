// Standalone transcriber (transcribe.html): no login, works for anything (orals, interviews, lectures).
import "./styles.css";
import { lang, setLang, tr } from "./i18n";
import { transcriberView } from "./transcribe/view";
import { h } from "./ui";

const app = document.getElementById("app")!;

function render(): void {
  document.documentElement.lang = lang;
  const main = h("main", { id: "main", class: "transcriber" });
  app.replaceChildren(
    h("header", { class: "top" },
      h("a", { class: "brand", href: "./transcribe.html" }, tr("Transcriber", "Transcriptor")),
      h("div", { class: "row" },
        h("a", { class: "btn btn-ghost btn-small", href: "./#/oral" }, tr("Paper Finder ↗", "Paper Finder ↗")),
        h("button", { class: "btn btn-ghost btn-small", onclick: () => { setLang(lang === "en" ? "es" : "en"); render(); } }, lang === "en" ? "ES" : "EN"))),
    main);
  transcriberView(main, { oralFirst: false });
}
render();
