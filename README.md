# IB Paper Finder

A private, invite-only web app for SIS students. The owner uploads the school's IB past papers and markschemes once. The app sorts them into a library, splits each paper into questions, and tags every question with syllabus topics. Approved students can then find questions by topic, read them next to the markscheme pages, build practice sets and track their own progress.

It runs on GitHub Pages (static files) with a separate Supabase project for logins, data and file storage. It can be installed on a Mac or iPad like an app.

## Privacy and invite-only rules

- **No papers in this repository.** The repo holds only code and topic lists. Papers and markschemes live only in a **private** Supabase Storage bucket called `papers`. `.gitignore` blocks `*.pdf` and `*.zip`.
- **Invite-only.** Anyone can send a request, and every new account starts as `pending`. Only the owner (the email on line 2 of `supabase/schema.sql`) can approve people. You can also limit requests to one email domain (Owner → People → Settings).
- **Row Level Security on every table.** Only approved users (and the owner) can read papers, questions and tags. Only the owner can add, change or delete library data or approve people. Progress rows (done / score / note) can be seen only by the student they belong to.
- **Removing someone works straight away.** Every database and storage check looks at the person's current status, and the app checks again on every screen change.
- **No public links.** Files open through signed links that expire after 60 seconds. Papers a person has opened are kept only on their own device for offline use, and wiped on logout or when access is removed. PDFs are drawn inside the app (pdf.js canvas); there is no plain download link to a paper.
- **Watermark.** Every page shown, and every exported practice-set PDF, says "Shared with <name> · for SIS students only".
- **Download switch.** Owner → People → "Allow students to download practice-set PDFs" (on by default). When it's off, students can only view practice sets inside the app.
- **Honest limit:** a browser app can't make copying impossible. An approved student who knows the tools could still save what their browser receives (or take screenshots). The watermark names them, and you can remove anyone at any time.

## What it does

1. **Organise (owner).** Library → Add papers: choose many PDFs, a whole folder, or .zip files (or drop them on the box). Each file is hashed and analysed in your browser (Web Worker + pdf.js), with a progress bar. The same file uploaded twice is skipped. The app reads the subject, level (HL/SL), year, session (May/November), timezone (TZ0/1/2), paper number and paper vs markscheme from the file name, and falls back to the first page's text. It knows the usual IB file name styles, including Spanish B ("Español B", "Lengua B", NS/NM, "prueba", "esquema de calificación") and English A Language and Literature. The library is grouped Subject → Year → Session/TZ → Paper, with the markscheme linked next to its paper. Missing markschemes, possible duplicates and files with missing details get a flag. **Edit** fixes any detail by hand for everyone and can re-split the paper.
2. **Questions by topic.** Each paper is split at question numbers ("1.", "2 (a)", "Question 3", "Pregunta 4"), and page ranges and marks are stored. If the numbering is unclear, the paper is split by page instead. Questions are tagged from the topic lists in `src/lib/topics/*.json` (one editable file per subject), and each tag shows how sure the match is (high / medium / low / checked). On a question page the owner can add or remove tags.
3. **Finder.** Choose a subject, then a topic, to see every matching question (year, session, TZ, paper, question, marks). You can filter by paper, level and years, and hide low-confidence tags. Clicking a question shows just its pages next to the matching markscheme pages.
4. **Practice sets.** Tick questions, then "Make practice set", to build one PDF (plus an optional markscheme PDF) in the browser with pdf-lib, with the watermark and the download setting applied.
5. **Personal progress.** Students mark a question done and can add a score and a private note. My progress shows done/total and average score per topic.
6. **Homework (tutor mode).** Owner: tick questions in the Finder, then **Set as homework**: give it a title, an optional due date and note, and pick approved students and/or saved groups (People → Groups, e.g. "BM group Tue"). Students see **Homework** first in the menu and a reminder at the top of the Finder: each set with its due date and questions in order; they open each question with its markscheme, mark it done, self-score (x / marks) and can leave a comment. Owner → Homework shows, per set and per student, not started / in progress / done, scores, comments, date finished and an overdue flag, and the owner can reply. Students only ever see sets assigned to them and their own answers.
7. **Search everything.** The search box at the top of every screen searches the text of every question you can open (English word forms, plus exact words for Spanish). Results show subject, paper, question and a snippet with your words highlighted; filter by subject, paper and year. The text is stored only in Supabase (never in this repo). For papers uploaded before search existed, the owner clicks Library → Library tools → **Fill search text for all papers** once.
8. **Practice mode.** Practice → pick a subject, any topics (none = all) and optionally a paper and level → a random question you haven't done, with a countdown from its marks (1.5 minutes per mark by default) → **Show markscheme** → score yourself → saved to your progress → next question. Tick "Include questions I've already done" to see those too. The owner changes the timer in People → Settings with a small JSON, e.g. `{"minutesPerMark": 1.5, "subjects": {"math-ai": 1.2}}` (subject ids: business, math-ai, psychology, sehs, spanish-b, english-a-ll).
9. **Exact markscheme jump.** When a paper and its markscheme are both in the library, the markscheme is split by the paper's question numbers and each question's markscheme pages are stored. "Show markscheme" (question page, practice mode, homework, practice-set PDFs) opens on that question's part; if it wasn't found, the whole markscheme is shown. On a question page the owner sees "Markscheme pages: x – y" to correct the mapping by hand (kept from then on; "Reset to automatic" undoes it). For papers added before this existed, click Library → Library tools → **Match markscheme pages for all papers** once.
10. **Offline.** The app itself is saved on the device, and every paper and markscheme you open is kept on that device (IndexedDB), with its details, so it opens again without internet; those show an **Available offline** badge (Finder, Library, question pages). Offline, a yellow bar says so, and anything not opened before says it needs a connection. Saving progress or homework needs a connection. The copies are deleted when you log out, when someone else signs in on the device, and when your access is removed (the next time the app opens with a connection, or the moment a file is refused).
11. English/Spanish switch (top right). Works in Safari and Chrome on Mac and iPad.

## Setup (in this order)

1. **Create the GitHub repo** `ib-paper-finder` and move the contents of this folder to its root. Then move `.github-template/workflows/deploy.yml` to `.github/workflows/deploy.yml`.
2. **Create a new Supabase project** at supabase.com. Keep it separate from the tutoring site's project.
3. **Set the owner email:** in `supabase/schema.sql`, line 2 holds the owner email (default `samidouniatutoring@gmail.com`). Change it there if you need to.
4. **Run the SQL:** in Supabase open SQL Editor → New query, paste the whole of `supabase/schema.sql`, and click Run. It is safe to run again later.
5. **Auth settings** (Supabase → Authentication):
   - Sign In / Providers → Email: enabled. Leaving "Confirm email" on is recommended.
   - URL Configuration → Site URL: `https://<your-github-username>.github.io/ib-paper-finder/`. Add the same address under Redirect URLs.
6. **Add the two Actions secrets** (GitHub repo → Settings → Secrets and variables → Actions → New repository secret):
   - `VITE_SUPABASE_URL`: Supabase → Project Settings → API → Project URL
   - `VITE_SUPABASE_ANON_KEY`: the `anon` / publishable key from the same page (never the service-role key)
7. **Turn on Pages:** GitHub repo → Settings → Pages → Source: **GitHub Actions**.
8. **Deploy:** push to `main` (or Actions → "Deploy to GitHub Pages" → Run workflow). The site appears at `https://<your-github-username>.github.io/ib-paper-finder/`.
9. **Sign up as the owner** on the site with the owner email. That account is approved automatically and gets the Library upload box and the People page.
10. **Upload papers** (Library → Add papers), then share the link with students. Approve them in People.

If the secrets are missing, the site still builds and shows "Not configured".

### Updating an existing setup (homework, search, practice, markscheme jump, offline)

1. Supabase → SQL Editor → New query: paste the whole of `supabase/schema.sql` again and click **Run** (safe to re-run; it adds the new tables and columns).
2. Deploy the new version (push to `main`).
3. Sign in as the owner → Library → **Library tools** → click **Fill search text for all papers**, wait until it says finished, then **Match markscheme pages for all papers**. This runs in your browser, so keep the tab open. New uploads do both automatically.
4. Optional: People → **Groups** to save student groups, and People → Settings to change the practice timer.

## Install as an app

- **Mac (Safari 17+):** open the site, then File → Add to Dock.
- **Mac (Chrome):** click the install icon in the address bar (or ⋮ → Cast, save and share → Install page as app).
- **iPad (Safari):** tap Share → Add to Home Screen.

The app saves its own code for offline use, plus the papers and markschemes each person has opened on that device (see "Offline" above). Nothing is downloaded in advance.

## Development

```bash
npm install
npm run dev
```

Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in a local `.env` file (see `.env.example`).

```bash
npm test
```

```bash
npm run build
```

The tests cover file name detection, question splitting, markscheme splitting (made-up sample text only), topic tagging, homework status, practice selection and timer, search snippets, offline helpers, and checks that the SQL has no public or anonymous read policy on papers, questions, tags, homework, markscheme ranges or the bucket.

## Editing topic lists

Each subject has one JSON file in `src/lib/topics/`. Each topic has a `code`, `name`, `group` and `keywords`. Optional fields: `nameEs`, `papers` (only tag on these paper numbers), `level`, and `marks` [min, max] (tag by marks, e.g. Psychology SAQ/ERQ). After editing, push to `main`. To re-tag existing papers, open Library → Edit → tick "Re-split and re-tag".

**Check against the current subject guides before relying on them**, especially SEHS (new guide; first exams 2026) and Psychology (the new guide changes the structure for exams from 2027; the list follows the approaches / options / HL extensions / SAQ–ERQ structure you asked for).
