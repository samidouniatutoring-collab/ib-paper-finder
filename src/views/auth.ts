import { db } from "../data";
import { tr } from "../i18n";
import { errorText, h, toast } from "../ui";

function form(fields: HTMLElement[], submit: string, onSubmit: (fd: FormData) => Promise<void>): HTMLFormElement {
  const button = h("button", { class: "btn", type: "submit" }, submit);
  const f = h("form", { class: "stack" }, ...fields, button);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    try {
      await onSubmit(new FormData(f));
    } catch (err) {
      toast(errorText(err), true);
    } finally {
      button.disabled = false;
    }
  });
  return f;
}

const input = (label: string, name: string, type = "text", extra: Record<string, unknown> = {}) =>
  h("label", { class: "field" }, h("span", {}, label), h("input", { name, type, required: true, ...extra }));

export function loginView(root: HTMLElement): void {
  root.replaceChildren(h("div", { class: "card narrow" },
    h("h1", {}, tr("Log in", "Iniciar sesión")),
    form([
      input(tr("Email", "Correo electrónico"), "email", "email", { autocomplete: "email" }),
      input(tr("Password", "Contraseña"), "password", "password", { autocomplete: "current-password" }),
    ], tr("Log in", "Entrar"), async (fd) => {
      const { error } = await db().auth.signInWithPassword({ email: String(fd.get("email")), password: String(fd.get("password")) });
      if (error) throw error;
    }),
    h("p", { class: "small" },
      h("a", { href: "#/signup" }, tr("Request access", "Solicitar acceso")), " · ",
      h("a", { href: "#/forgot" }, tr("Forgot password?", "¿Has olvidado la contraseña?")),
    ),
  ));
}

export async function signupView(root: HTMLElement): Promise<void> {
  const { data: domain } = await db().rpc("signup_domain");
  root.replaceChildren(h("div", { class: "card narrow" },
    h("h1", {}, tr("Request access", "Solicitar acceso")),
    h("p", { class: "notice" }, tr(
      "Access is invite-only for Sami's tutoring students. Your request goes to Sami for approval.",
      "El acceso es solo por invitación para los alumnos de clases particulares de Sami. Tu solicitud le llega a Sami para que la apruebe.",
    )),
    domain ? h("p", { class: "small muted" }, `${tr("Use your", "Usa tu correo")} @${domain} ${tr("email address.", "")}`) : "",
    form([
      input(tr("Full name", "Nombre completo"), "name", "text", { autocomplete: "name" }),
      input(tr("Email", "Correo electrónico"), "email", "email", { autocomplete: "email" }),
      input(tr("Password (at least 8 characters)", "Contraseña (mínimo 8 caracteres)"), "password", "password", { minlength: 8, autocomplete: "new-password" }),
    ], tr("Send request", "Enviar solicitud"), async (fd) => {
      const email = String(fd.get("email")).trim().toLowerCase();
      if (domain && !email.endsWith(`@${domain}`)) throw new Error(tr(`Only @${domain} addresses can request access.`, `Solo pueden solicitar acceso las direcciones @${domain}.`));
      const { data, error } = await db().auth.signUp({
        email,
        password: String(fd.get("password")),
        options: { data: { full_name: String(fd.get("name")).trim() }, emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      if (!data.session) {
        root.replaceChildren(h("div", { class: "card narrow" }, h("h1", {}, tr("Check your inbox", "Revisa tu correo")),
          h("p", {}, tr("Confirm your email address, then log in. Sami will then approve your request.", "Confirma tu correo y luego inicia sesión. Después Sami aprobará tu solicitud."))));
      }
    }),
    h("p", { class: "small" }, h("a", { href: "#/login" }, tr("I already have an account", "Ya tengo cuenta"))),
  ));
}

export function forgotView(root: HTMLElement): void {
  root.replaceChildren(h("div", { class: "card narrow" },
    h("h1", {}, tr("Reset password", "Restablecer contraseña")),
    form([input(tr("Email", "Correo electrónico"), "email", "email")], tr("Send link", "Enviar enlace"), async (fd) => {
      const { error } = await db().auth.resetPasswordForEmail(String(fd.get("email")), { redirectTo: location.origin + location.pathname });
      if (error) throw error;
      toast(tr("If the address has an account, a link is on its way.", "Si la dirección tiene cuenta, te llegará un enlace."));
    }),
    h("p", { class: "small" }, h("a", { href: "#/login" }, tr("Back to log in", "Volver"))),
  ));
}

export function newPasswordView(root: HTMLElement, done: () => void): void {
  root.replaceChildren(h("div", { class: "card narrow" },
    h("h1", {}, tr("Choose a new password", "Elige una contraseña nueva")),
    form([input(tr("New password", "Contraseña nueva"), "password", "password", { minlength: 8, autocomplete: "new-password" })], tr("Save", "Guardar"), async (fd) => {
      const { error } = await db().auth.updateUser({ password: String(fd.get("password")) });
      if (error) throw error;
      toast(tr("Password changed", "Contraseña cambiada"));
      done();
    }),
  ));
}

export function waitingView(root: HTMLElement, removed: boolean): void {
  root.replaceChildren(h("div", { class: "card narrow" },
    h("h1", {}, removed ? tr("Access removed", "Acceso retirado") : tr("Waiting for approval", "Esperando aprobación")),
    h("p", {}, removed
      ? tr("Your access to the library has been removed. Ask Sami if you think this is a mistake.", "Se ha retirado tu acceso a la biblioteca. Pregunta a Sami si crees que es un error.")
      : tr("Thanks! Sami will review your request. Come back later; this page updates when you're approved.", "¡Gracias! Sami revisará tu solicitud. Vuelve más tarde; esta página cambia cuando te aprueben.")),
    h("button", { class: "btn btn-secondary", onclick: () => location.reload() }, tr("Check again", "Comprobar de nuevo")),
  ));
}
