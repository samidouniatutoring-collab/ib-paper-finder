import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8").toLowerCase();
const policies = sql.split(";").filter((s) => s.includes("create policy"));
const LIBRARY = ["public.papers", "public.questions", "public.question_tags", "storage.objects"];

describe("schema.sql access rules", () => {
  it("sets the owner email on line 2", () => {
    expect(sql.split("\n")[1]).toContain("samidouniatutoring@gmail.com");
  });

  it("has no public or anonymous read policy on library data or the papers bucket", () => {
    for (const p of policies.filter((p) => LIBRARY.some((t) => p.includes(` on ${t} `)))) {
      expect(p).not.toMatch(/\bto (anon|public)\b/);
      expect(p).toMatch(/\bto authenticated\b/);
      expect(p).toMatch(/is_approved\(\)|is_owner\(\)|can_see_paper\(|can_see_question\(/);
      expect(p).not.toMatch(/using \(true\)/);
    }
  });

  it("only the owner can write library data", () => {
    const writes = policies.filter(
      (p) => LIBRARY.some((t) => p.includes(` on ${t} `)) && /for (all|insert|update|delete)/.test(p) && !p.includes('"submissions bucket: own"'),
    );
    expect(writes.length).toBeGreaterThanOrEqual(6);
    for (const p of writes) expect(p).toContain("is_owner()");
  });

  it("students can only write submissions in their own folder, for homework assigned to them", () => {
    const own = policies.find((p) => p.includes('"submissions bucket: own"'))!;
    expect(own).toContain("bucket_id = 'submissions'");
    expect(own).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    expect(own).toMatch(/is_assigned\(\(\(storage\.foldername\(name\)\)\[2\]\)::uuid\)/);
    expect(own.match(/is_assigned/g)?.length).toBe(2);
    const table = policies.find((p) => p.includes('"submissions: own"'))!;
    expect(table).toContain("user_id = auth.uid() and public.is_assigned(set_id)");
  });

  it("keeps the papers bucket private and enables RLS everywhere", () => {
    expect(sql).toMatch(/insert into storage\.buckets[^;]*'papers', false\)/);
    expect(sql).not.toMatch(/public\s*=\s*true/);
    expect(sql).not.toContain("getpublicurl");
    for (const t of ["profiles", "app_settings", "papers", "questions", "question_tags", "progress"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
  });
});

describe("schema.sql homework rules", () => {
  const HW = ["student_groups", "student_group_members", "homework_sets", "homework_items", "homework_assignments", "homework_answers"];
  it("enables RLS and has no anonymous or open policy on homework tables", () => {
    for (const t of HW) expect(sql).toContain(`alter table public.${t} enable row level security`);
    for (const p of policies.filter((p) => HW.some((t) => p.includes(` on public.${t} `)))) {
      expect(p).toMatch(/\bto authenticated\b/);
      expect(p).not.toMatch(/using \(true\)/);
      expect(p).toMatch(/is_owner\(\)|is_assigned\(|is_approved\(\)/);
    }
  });
  it("students only write their own answers on sets assigned to them", () => {
    const p = policies.find((p) => p.includes('"hw answers: own rows"'))!;
    expect(p).toContain("user_id = auth.uid()");
    expect(p).toContain("is_assigned(set_id)");
  });
});

describe("schema.sql search", () => {
  it("search runs with the caller's rights (RLS applies) and is not open to anon", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.search_questions"));
    expect(fn.slice(0, fn.indexOf("$$"))).toContain("security invoker");
    expect(sql).toMatch(/revoke all on function public\.search_questions[^;]*from public, anon/);
    expect(sql).toContain("to_tsvector('english', body)");
    expect(sql).toContain("to_tsvector('simple', body)");
  });
});

describe("schema.sql markscheme ranges", () => {
  it("only approved users read and only the owner writes", () => {
    expect(sql).toContain("alter table public.markscheme_ranges enable row level security");
    const ps = policies.filter((p) => p.includes(" on public.markscheme_ranges "));
    expect(ps).toHaveLength(2);
    for (const p of ps) expect(p).toMatch(/is_approved\(\)|is_owner\(\)|can_see_question\(/);
    expect(ps.find((p) => p.includes("for all"))).toContain("is_owner()");
  });
});

describe("schema.sql access per person", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.can_see_paper"), sql.indexOf("create or replace function public.can_see_question"));
  it("owner sees all, unapproved see nothing, full access is limited to the ticked subjects", () => {
    expect(fn).toContain("when public.is_owner() then true");
    expect(fn).toContain("when not public.is_approved() then false");
    expect(fn).toContain("me.subjects is null or p.subject = any (me.subjects)");
  });
  it("homework-only people only see papers behind homework assigned to them", () => {
    expect(fn).toContain("ha.user_id = auth.uid()");
    expect(fn).toContain("join public.homework_items hi on hi.set_id = ha.set_id");
  });
  it("new people default to homework only, and every library read rule goes through can_see_*", () => {
    expect(sql).toContain("add column if not exists access text not null default 'homework'");
    for (const name of ['"papers: approved read"', '"questions: approved read"', '"tags: approved read"', '"ms ranges: approved read"', '"papers bucket: approved read"']) {
      const ps = policies.filter((p) => p.includes(`create policy ${name}`));
      expect(ps).toHaveLength(1);
      expect(ps[0]).toMatch(/can_see_(paper|question)\(/);
    }
  });
});
