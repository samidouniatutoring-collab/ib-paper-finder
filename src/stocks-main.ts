// Standalone portfolio tracker (stocks.html). All data stays in this browser.
import "./styles.css";
import "./stocks/stocks.css";
import { h } from "./ui";
import { mount } from "./stocks/view";

const app = document.getElementById("app")!;
const main = h("main", { id: "main", class: "stocks" });
app.replaceChildren(h("header", { class: "top" }, h("a", { class: "brand", href: "./stocks.html" }, "Portfolio"), h("span", { class: "small muted" }, "Not financial advice · data: Finnhub, ECB")), main);
mount(main);

if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
