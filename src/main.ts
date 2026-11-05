import "./lib/stream-polyfill";
import "./styles.css";
import { supabase } from "./config";
import { db, isOwner, state, type Profile, type Settings } from "./data";
import { lang, setLang, tr } from "./i18n";
import { clearOffline, getJson, initOffline, isNetworkError, offlineUser, setOfflineUser, withOffline } from "./offline";
import { errorText, h } from "./ui";
import { fullPaperView } from "./views/full-paper";
import { markingView } from "./views/marking";
import { forgotView, loginView, newPasswordView, signupView, waitingView } from "./views/auth";
import { finderView } from "./views/finder";
import { homeworkListView, homeworkSetView } from "./views/homework";
import { libraryView } from "./views/library";
import { peopleView } from "./views/people";
import { practiceModeView } from "./views/practice-mode";
import { progressView } from "./views/progress";
import { searchBox, searchView } from "./views/search";
import { paperView, questionView } from "./views/viewer";

const app = document.getElementById("app")!;
let recovering = false;

function header(signedIn: boolean): HTMLElement {
  const links: [string, string][] = signedIn && state.profile?.status === "approved"
    ? [["#/homework", tr("Homework", "Deberes")], ["#/", tr("Finder", "Buscador")], ["#/practice", tr("Practice", "Práctica")], ["#/library", tr("Library", "Biblioteca")], ["#/progress", tr("Progress", "Progreso")], ...(isOwner() ? [["#/marking", tr("Marking", "Corregir")] as [string, string], ["#/people", tr("People", "Personas")] as [string, string]] : [])]
    : [];
  return h("header", { class: "top" },
    h("a", { class: "brand", href: "#/" }, "IB Paper Finder"),
    h("nav", {}, ...links.map(([href, label]) => h("a", { href, class: location.hash === href || (href !== "#/" && location.hash.startsWith(href + "/")) || (href === "#/" && !location.hash) ? "active" : "" }, label))),
    h("div", { class: "row" },
      links.length ? searchBox() : "",
      h("button", { class: "btn btn-ghost btn-small", onclick: () => { setLang(lang === "en" ? "es" : "en"); void route(); }, "aria-label": "Language / Idioma" }, lang === "en" ? "ES" : "EN"),
      signedIn ? h("button", { class: "btn btn-ghost btn-small", onclick: async () => { await clearOffline(); await db().auth.signOut(); } }, tr("Log out", "Salir")) : "",
    ),
  );
}

/** The signed-in person's profile. Offline, the copy saved on this device is used (same person only). */
async function loadProfile(): Promise<Profile | null> {
  const { data: u, error: authErr } = await db().auth.getUser();
  if (!u.user) {
    if (authErr && isNetworkError(authErr)) {
      const { data: s } = await db().auth.getSession();
      const uid = s.session?.user.id;
      if (uid && uid === offlineUser()) {
        offlineMode = true;
        return (await getJson<Profile>("profile")) ?? null;
      }
    }
    return null;
  }
  offlineMode = false;
  const { data, error } = await db().from("profiles").select("*").eq("id", u.user.id).maybeSingle();
  if (error && isNetworkError(error) && u.user.id === offlineUser()) {
    offlineMode = true;
    return (await getJson<Profile>("profile")) ?? null;
  }
  const profile = (data as Profile) ?? null;
  // Only approved people keep offline copies; removing someone wipes theirs the next time they open the app.
  await setOfflineUser(profile?.id ?? null, profile?.status === "approved");
  if (profile?.status === "approved") await withOffline("profile", async () => profile);
  return profile;
}

let offlineMode = false;
const offlineBar = h("div", { class: "offline-bar", role: "status" });

function updateOfflineBar(): void {
  offlineBar.hidden = !(offlineMode || navigator.onLine === false);
  offlineBar.textContent = tr("You're offline. Papers and markschemes you've opened on this device still work.", "No tienes conexión. Los exámenes y esquemas que ya abriste en este dispositivo siguen funcionando.");
}

async function route(): Promise<void> {
  document.documentElement.lang = lang;
  if (!supabase) {
    app.replaceChildren(header(false), h("main", { id: "main" }, h("div", { class: "card narrow" },
      h("h1", {}, tr("Not configured", "Sin configurar")),
      h("p", {}, tr("This build has no Supabase settings. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as repository Actions secrets and deploy again.",
        "Esta versión no tiene la configuración de Supabase. Añade VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY como secretos de Actions y vuelve a publicar.")))));
    return;
  }
  const main = h("main", { id: "main" });
  // Re-check the profile on every navigation so removing someone takes effect at once.
  state.profile = await loadProfile().catch(() => null);
  app.replaceChildren(header(!!state.profile), offlineBar, main);
  updateOfflineBar();
  const [path, query = ""] = (location.hash.replace(/^#/, "") || "/").split("?");

  if (recovering) return newPasswordView(main, () => { recovering = false; location.hash = "#/"; void route(); });
  if (!state.profile) {
    if (path === "/signup") return signupView(main);
    if (path === "/forgot") return forgotView(main);
    return loginView(main);
  }
  if (state.profile.status !== "approved") return waitingView(main, state.profile.status === "removed");

  const settings = await withOffline("settings", async () => {
    const { data, error } = await db().from("app_settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data;
  }).catch(() => null);
  if (settings) state.settings = settings as Settings;

  try {
    const [, section, id] = path.split("/");
    if (section === "search") await searchView(main, new URLSearchParams(query));
    else if (section === "homework" && id) await homeworkSetView(main, id);
    else if (section === "homework") await homeworkListView(main);
    else if (section === "practice") await practiceModeView(main);
    else if (section === "library") await libraryView(main);
    else if (section === "progress") await progressView(main);
    else if (section === "people" && isOwner()) await peopleView(main);
    else if (section === "marking" && isOwner()) await markingView(main, id);
    else if (section === "q" && id) await questionView(main, id);
    else if (section === "paper" && id) await paperView(main, id);
    else if (section === "full" && id) await fullPaperView(main, id);
    else await finderView(main);
  } catch (e) {
    main.replaceChildren(h("div", { class: "card" }, h("h1", {}, tr("Something went wrong", "Algo ha fallado")), h("p", {}, errorText(e))));
  }
}

window.addEventListener("hashchange", () => void route());
let lastUser: string | null | undefined;
supabase?.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") recovering = true;
  if (event === "SIGNED_OUT") void clearOffline();
  const user = session?.user.id ?? null;
  // Only re-render when the signed-in person changes (Supabase also fires SIGNED_IN on tab focus).
  if (event === "PASSWORD_RECOVERY" || (lastUser !== undefined && user !== lastUser)) setTimeout(() => void route(), 0);
  lastUser = user;
});
window.addEventListener("online", () => { offlineMode = false; updateOfflineBar(); });
window.addEventListener("offline", updateOfflineBar);
void initOffline().finally(() => void route());

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
}
