// The transcriber screen. Used twice: as the standalone app (transcribe.html, no login)
// and as the "Oral" tab inside Paper Finder (same code, oral options first).

import { tr } from "../i18n";
import { errorText, h, toast } from "../ui";
import { analyse, frameDb, percentile, voiceActivity, yinPitch, encodeWav } from "./acoustics";
import { decodeFile, tick } from "./audio";
import { friendlyError, loadSettings, mimeFor, pronunciationNotes, removeUpload, saveSettings, transcribeFlash, transcribeSpeech, upload, type EngineSettings } from "./gemini";
import { deleteJob, loadHistory, saveJob } from "./history";
import { PURPOSES, SUBJECTS, buildPacket, clock, describeSpeaker, guessCandidate, nameOf, safeName, transcriptDocx, transcriptText } from "./packet";
import type { Job, Purpose } from "./types";

const LANGS: [string, string][] = [["es-ES", "Español"], ["en-GB", "English"], ["fr-FR", "Français"]];

function download(blob: Blob, name: string): void {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function copy(text: string, done: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch { toast(tr("Copy failed: use the download button instead.", "No se pudo copiar: usa el botón de descarga."), true); }
}

function settingsCard(onSave: () => void): HTMLElement {
  const s = loadSettings();
  const key = h("input", { type: "password", value: s.apiKey, placeholder: "AIza…", autocomplete: "off", style: "min-width: 280px" });
  const engine = h("select", {},
    h("option", { value: "transcribe", selected: s.engine === "transcribe" }, tr("Speech model (best: verbatim, speakers, word times)", "Modelo de voz (mejor: literal, hablantes, tiempos)")),
    h("option", { value: "flash", selected: s.engine === "flash" }, tr("Flash (fallback if the speech model isn't on your plan)", "Flash (alternativa si tu plan no incluye el modelo de voz)")));
  const tm = h("input", { value: s.transcribeModel });
  const fm = h("input", { value: s.flashModel });
  const details = h("details", { class: "card", open: !s.apiKey },
    h("summary", {}, h("strong", {}, tr("Settings", "Ajustes")), s.apiKey ? h("span", { class: "badge badge-ok" }, tr("key saved", "clave guardada")) : h("span", { class: "badge badge-warn" }, tr("add your key", "añade tu clave"))),
    h("div", { class: "stack", style: "margin-top: 0.75rem" },
      h("p", { class: "small muted" },
        tr("The transcription runs on Google Gemini with your own free key: ", "La transcripción usa Google Gemini con tu propia clave gratuita: "),
        h("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "aistudio.google.com → Get API key"),
        tr(". The key is saved only in this browser. On Google's free tier, Google may use what you upload to improve its products, so don't upload anything private you wouldn't share.",
          ". La clave solo se guarda en este navegador. En el plan gratuito, Google puede usar lo que subes para mejorar sus productos: no subas nada privado que no compartirías.")),
      h("label", { class: "field" }, tr("Google AI Studio API key", "Clave de API de Google AI Studio"), key),
      h("label", { class: "field" }, tr("Engine", "Motor"), engine),
      h("details", {}, h("summary", { class: "small muted" }, tr("Advanced: model names", "Avanzado: nombres de modelo")),
        h("div", { class: "row" }, h("label", { class: "field" }, tr("Speech model", "Modelo de voz"), tm), h("label", { class: "field" }, "Flash", fm))),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => {
        const next: EngineSettings = { apiKey: key.value.trim(), engine: engine.value as EngineSettings["engine"], transcribeModel: tm.value.trim() || "gemini-3.5-transcribe", flashModel: fm.value.trim() || "gemini-3.5-flash" };
        saveSettings(next); toast(tr("Saved", "Guardado")); onSave();
      } }, tr("Save", "Guardar")))));
  return details;
}

interface Opts { oralFirst: boolean; }

/** The settings card, redrawn in place after saving (so a file already chosen below isn't lost). */
function settingsSlot(): HTMLElement {
  const slot = h("div", {});
  const draw = () => slot.replaceChildren(settingsCard(draw));
  draw();
  return slot;
}

export function transcriberView(root: HTMLElement, opts: Opts): void {
  const render = () => {
    root.replaceChildren(
      h("h1", {}, opts.oralFirst ? tr("Oral grading", "Corregir orales") : tr("Transcriber", "Transcriptor")),
      h("p", { class: "muted" }, opts.oralFirst
        ? tr("Upload a recording of an oral (or a solo practice). You get a word-for-word transcript with your mistakes kept, audio measurements, and a grading packet to give to Claude, which grades it against the IB criteria.",
          "Sube la grabación de un oral (o de una práctica tú solo). Obtienes una transcripción literal con tus errores, medidas del audio y un paquete para que Claude lo corrija con los criterios del IB.")
        : tr("Word-for-word transcripts of anything: orals, interviews, lectures. Spanish, English and French, with speakers separated and mistakes kept.",
          "Transcripciones literales de cualquier cosa: orales, entrevistas, clases. Español, inglés y francés, con hablantes separados y errores incluidos.")),
      settingsSlot(),
      newJobCard(root, opts, render),
      historyCard(root, opts, render),
    );
  };
  render();
}

function newJobCard(root: HTMLElement, opts: Opts, rerender: () => void): HTMLElement {
  const file = h("input", { type: "file", accept: "audio/*,video/*,.m4a,.mp3,.wav,.mp4,.mov,.ogg,.webm,.flac,.aac" });
  const purpose = h("select", {}, ...PURPOSES.map((p) => h("option", { value: p.id, selected: p.id === (opts.oralFirst ? "oral" : "interview") }, p.label)));
  const subject = h("select", {}, ...SUBJECTS.map((s) => h("option", { value: s.id, selected: s.id === (opts.oralFirst ? "spanish-b-sl-io" : "none") }, s.label)));
  const langBoxes = LANGS.map(([code, label]) => {
    const box = h("input", { type: "checkbox", value: code, checked: opts.oralFirst ? code === "es-ES" : false });
    return { box, el: h("label", { class: "check" }, box, label) };
  });
  const pron = h("input", { type: "checkbox", checked: opts.oralFirst });
  const status = h("div", { class: "stack" });
  const go = h("button", { class: "btn" }, tr("Transcribe", "Transcribir"));
  const syncSubject = () => {
    const p = purpose.value as Purpose;
    if ((p === "oral" || p === "solo") && subject.value === "none") subject.value = "spanish-b-sl-io";
    if (p === "interview" && subject.value === "none") subject.value = "interview";
    pron.checked = p === "oral" || p === "solo";
  };
  const syncLang = () => {
    const l = SUBJECTS.find((x) => x.id === subject.value)?.language;
    const code = l === "Spanish" ? "es-ES" : l === "French" ? "fr-FR" : l === "English" ? "en-GB" : null;
    if (code) langBoxes.forEach((b) => (b.box.checked = b.box.value === code));
  };
  purpose.addEventListener("change", () => { syncSubject(); syncLang(); });
  subject.addEventListener("change", syncLang);

  go.addEventListener("click", () => void (async () => {
    const f = file.files?.[0];
    if (!f) return toast(tr("Choose a recording first.", "Elige una grabación primero."), true);
    const settings = loadSettings();
    if (!settings.apiKey) return toast(tr("Add your API key in Settings first.", "Añade tu clave de API en Ajustes primero."), true);
    go.disabled = true;
    const steps: HTMLElement[] = [];
    const step = (label: string) => { steps.forEach((s) => s.classList.add("muted")); const el = h("p", { class: "small", "aria-busy": "true" }, "⏳ ", label); steps.push(el); status.append(el); return el; };
    const done = (el: HTMLElement, label?: string) => { el.removeAttribute("aria-busy"); el.textContent = `✓ ${label ?? el.textContent!.replace(/^⏳ /, "")}`; };
    status.replaceChildren();
    let uploaded: Awaited<ReturnType<typeof upload>> | null = null;
    try {
      const languages = langBoxes.filter((l) => l.box.checked).map((l) => l.box.value);
      let s = step(tr("Reading the audio…", "Leyendo el audio…"));
      await tick();
      const dec = await decodeFile(f);
      done(s, `${tr("Audio read", "Audio leído")} (${clock(dec.durationSec)})`);
      if (dec.durationSec > 30 * 60) toast(tr("Over 30 minutes: speaker labels may not work. Split the file if it fails.", "Más de 30 minutos: puede que no separe hablantes. Divide el archivo si falla."), true);

      s = step(tr("Measuring pace, pauses and pitch…", "Midiendo ritmo, pausas y tono…"));
      await tick();
      const db = frameDb(dec.samples, dec.sr);
      const vad = voiceActivity(db);
      const f0 = yinPitch(dec.pitchSamples, dec.pitchSr);
      done(s);

      s = step(tr("Uploading to Google…", "Subiendo a Google…"));
      const mime = mimeFor(f);
      const blob = mime ? f : encodeWav(dec.samples, dec.sr);
      uploaded = await upload(settings, blob, mime ?? "audio/wav", f.name);
      done(s);

      s = step(tr("Transcribing word for word (a 10-minute recording takes about 1–3 minutes)…", "Transcribiendo palabra por palabra (10 minutos de audio tardan 1–3 minutos)…"));
      const p = purpose.value as Purpose;
      const hint = p === "solo" ? "There is one speaker." : p === "oral" ? "Usually two speakers: an examiner and a student." : "";
      const segments = settings.engine === "flash" ? await transcribeFlash(settings, uploaded, languages, hint) : await transcribeSpeech(settings, uploaded, languages);
      done(s, `${tr("Transcribed", "Transcrito")}: ${segments.length} ${tr("turns", "turnos")}`);

      const candidate = p === "other" ? null : guessCandidate(segments);
      const analysis = analyse(segments, vad, f0, 0.04, dec.durationSec, percentile(db, 0.1));
      const job: Job = {
        id: crypto.randomUUID(), createdAt: new Date().toISOString(), fileName: f.name, purpose: p, subject: subject.value, languages,
        engine: settings.engine === "flash" ? settings.flashModel : settings.transcribeModel,
        segments, speakerNames: {}, candidate, analysis, pron: null,
      };
      if (candidate && (p === "solo" || p === "oral")) job.speakerNames[candidate] = tr("Candidate", "Candidato");
      if (p === "oral") for (const spk of new Set(segments.map((x) => x.speaker))) if (spk !== candidate) job.speakerNames[spk] = tr("Examiner", "Examinadora");

      if (pron.checked && candidate) {
        s = step(tr("Noting pronunciation and intonation (observations only, no marks)…", "Anotando pronunciación y entonación (solo observaciones, sin nota)…"));
        try {
          const lang = SUBJECTS.find((x) => x.id === job.subject)?.language || "the language spoken";
          const who = p === "solo" ? "the speaker" : `the student (the person who speaks most, first heard at ${clock(segments.find((x) => x.speaker === candidate)?.start ?? 0)})`;
          job.pron = await pronunciationNotes(settings, uploaded, lang, who, segments.filter((x) => x.speaker === candidate).map((x) => `[${clock(x.start)}] ${x.text}`).join("\n"));
          done(s);
        } catch (e) {
          done(s, `${tr("Pronunciation notes skipped", "Notas de pronunciación omitidas")}: ${friendlyError(e)}`);
        }
      }
      saveJob(job);
      root.replaceChildren(resultView(job, () => { rerender(); }));
      window.scrollTo(0, 0);
    } catch (e) {
      status.append(h("p", { class: "notice", style: "color: var(--danger)" }, friendlyError(e)));
      go.disabled = false;
    } finally {
      if (uploaded) void removeUpload(settings, uploaded.name);
    }
  })());

  return h("div", { class: "card stack" },
    h("h2", {}, tr("New recording", "Nueva grabación")),
    h("label", { class: "field" }, tr("Recording (audio or video, up to 30 min)", "Grabación (audio o vídeo, hasta 30 min)"), file),
    h("div", { class: "row" }, h("label", { class: "field" }, tr("What is it?", "¿Qué es?"), purpose), h("label", { class: "field" }, tr("Subject / grading", "Asignatura / corrección"), subject)),
    h("div", { class: "field" }, tr("Languages spoken (leave all empty to auto-detect)", "Idiomas (déjalos vacíos para detectarlos solo)"), h("div", { class: "row" }, ...langBoxes.map((l) => l.el))),
    h("label", { class: "check" }, pron, tr("Pronunciation & intonation notes for the graded speaker (one extra request)", "Notas de pronunciación y entonación del hablante evaluado (una petición más)")),
    h("div", { class: "row" }, go),
    status,
  );
}

function historyCard(root: HTMLElement, _opts: Opts, rerender: () => void): HTMLElement {
  const list = loadHistory();
  return h("div", { class: "card" },
    h("h2", {}, tr("Saved on this device", "Guardado en este dispositivo")),
    list.length
      ? h("ul", { class: "qlist" }, ...list.map((j) => h("li", { class: "qrow" },
          h("a", { href: "javascript:void 0", onclick: () => { root.replaceChildren(resultView(j, rerender)); window.scrollTo(0, 0); } },
            h("strong", {}, j.fileName), h("div", { class: "small muted" }, `${j.createdAt.slice(0, 10)} · ${SUBJECTS.find((s) => s.id === j.subject)?.label ?? ""} · ${j.analysis ? clock(j.analysis.durationSec) : ""}`)),
          h("button", { class: "btn btn-ghost btn-small", onclick: () => { if (confirm(tr("Delete this transcript from this device?", "¿Borrar esta transcripción de este dispositivo?"))) { deleteJob(j.id); rerender(); } } }, tr("Delete", "Borrar")))))
      : h("p", { class: "muted small" }, tr("Nothing yet. Transcripts are kept here (text only, never the audio).", "Nada todavía. Las transcripciones se guardan aquí (solo texto, nunca el audio).")),
  );
}

function resultView(job: Job, back: () => void): HTMLElement {
  const speakers = [...new Set(job.segments.map((s) => s.speaker))];
  const save = () => saveJob(job);
  const transcriptBox = h("div", { class: "transcript" });
  const metricsBox = h("div", {});
  const drawTranscript = () => transcriptBox.replaceChildren(...job.segments.map((s) => h("p", { class: `turn${s.speaker === job.candidate ? " turn-cand" : ""}` },
    h("span", { class: "mono muted" }, `[${clock(s.start)}] `), h("strong", {}, `${nameOf(job, s.speaker)}: `), s.text)));
  const drawMetrics = () => metricsBox.replaceChildren(...(job.analysis?.speakers ?? []).map((m) => h("div", { class: "metric" },
    h("h3", {}, nameOf(job, m.speaker), m.speaker === job.candidate ? h("span", { class: "badge" }, tr("graded", "evaluado")) : ""),
    h("ul", { class: "small" }, ...describeSpeaker(m, job.purpose === "solo").map((l) => h("li", {}, l))))));

  const nameInputs = speakers.map((spk) => {
    const inp = h("input", { value: nameOf(job, spk), style: "width: 11rem" });
    inp.addEventListener("change", () => { job.speakerNames[spk] = inp.value.trim() || spk; save(); drawTranscript(); drawMetrics(); });
    return h("label", { class: "field" }, `${spk}`, inp);
  });
  const cand = h("select", {}, h("option", { value: "" }, tr("nobody", "nadie")), ...speakers.map((spk) => h("option", { value: spk, selected: spk === job.candidate }, nameOf(job, spk))));
  cand.addEventListener("change", () => { job.candidate = cand.value || null; save(); drawTranscript(); drawMetrics(); });

  drawTranscript();
  drawMetrics();
  const base = safeName(job.fileName);
  const grading = job.subject !== "none";
  return h("div", {},
    h("div", { class: "row", style: "justify-content: space-between" },
      h("h1", {}, job.fileName),
      h("button", { class: "btn btn-ghost", onclick: back }, tr("← Back", "← Volver"))),
    grading ? h("div", { class: "card notice stack" },
      h("strong", {}, tr("Get it graded by Claude", "Que lo corrija Claude")),
      h("p", { class: "small" }, tr("1. Download the grading packet (or copy it). 2. In Claude, attach or paste it and say “grade this oral”. The ib-oral-grader skill grades it against the IB criteria, quoting your transcript.",
        "1. Descarga el paquete (o cópialo). 2. En Claude, adjúntalo o pégalo y di “grade this oral”. La skill ib-oral-grader lo corrige con los criterios del IB, citando tu transcripción.")),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => download(new Blob([buildPacket(job)], { type: "text/markdown" }), `${base}_grading-packet.md`) }, tr("Download grading packet", "Descargar paquete")),
        h("button", { class: "btn btn-secondary", onclick: () => void copy(buildPacket(job), tr("Packet copied: paste it into Claude.", "Paquete copiado: pégalo en Claude.")) }, tr("Copy packet", "Copiar paquete")),
        h("a", { class: "btn btn-ghost", href: "https://claude.ai/new", target: "_blank", rel: "noopener" }, tr("Open Claude ↗", "Abrir Claude ↗")))) : "",
    h("div", { class: "card stack" },
      h("h2", {}, tr("Speakers", "Hablantes")),
      h("div", { class: "row" }, ...nameInputs, h("label", { class: "field" }, tr("Graded speaker", "Hablante evaluado"), cand))),
    h("div", { class: "card" },
      h("div", { class: "row", style: "justify-content: space-between" },
        h("h2", {}, tr("Verbatim transcript", "Transcripción literal")),
        h("div", { class: "row" },
          h("button", { class: "btn btn-secondary btn-small", onclick: () => void copy(transcriptText(job), tr("Transcript copied", "Transcripción copiada")) }, tr("Copy", "Copiar")),
          h("button", { class: "btn btn-secondary btn-small", onclick: () => download(new Blob([transcriptText(job)], { type: "text/plain" }), `${base}_transcript.txt`) }, ".txt"),
          h("button", { class: "btn btn-secondary btn-small", onclick: () => void transcriptDocx(job).then((b) => download(b, `${base}_transcript.docx`)).catch((e) => toast(errorText(e), true)) }, "Word"))),
      transcriptBox),
    job.analysis ? h("div", { class: "card" }, h("h2", {}, tr("Audio measurements", "Medidas del audio")),
      h("p", { class: "small muted" }, tr("Measured from the sound wave, not judged by ear: speed, pauses, fillers and how much the pitch moves (flat vs expressive intonation).", "Medido de la onda de sonido, no a oído: velocidad, pausas, muletillas y cuánto se mueve el tono (entonación plana o expresiva).")),
      metricsBox) : "",
    job.pron ? h("div", { class: "card" }, h("h2", {}, tr("Pronunciation & intonation notes", "Notas de pronunciación y entonación")),
      h("p", { class: "small muted" }, tr("Machine observations to check, not a grade.", "Observaciones automáticas para revisar, no una nota.")),
      h("p", {}, h("strong", {}, tr("Intonation: ", "Entonación: ")), job.pron.intonation),
      h("p", {}, h("strong", {}, tr("Overall: ", "En general: ")), job.pron.overall),
      job.pron.notes.length ? h("table", { class: "progress-table" },
        h("tr", {}, h("th", {}, tr("Time", "Tiempo")), h("th", {}, tr("Said", "Dicho")), h("th", {}, tr("Expected", "Esperado")), h("th", {}, tr("Issue", "Problema"))),
        ...job.pron.notes.map((n) => h("tr", {}, h("td", { class: "mono" }, n.time), h("td", {}, n.said), h("td", {}, n.expected), h("td", {}, n.issue)))) : "") : "",
  );
}
