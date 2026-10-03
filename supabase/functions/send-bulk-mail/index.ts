// Supabase Edge Function: send-bulk-mail
//
// The browser cannot talk SMTP, so the Bulk Mailer page calls this function. It
//   1. checks the caller holds the mail.send permission in the club they are mailing for,
//   2. reads one slice of that club's mailing list (the recipients never leave the server),
//   3. sends the already-built e-mail to each address through your SMTP account.
//
// Secrets (Dashboard -> Edge Functions -> Secrets):
//   SMTP_HOST   e.g. smtp.gmail.com
//   SMTP_PORT   465 (SSL, default) or 587 (STARTTLS)
//   SMTP_USER   the mailbox login, e.g. club@gmail.com
//   SMTP_PASS   its password (Gmail: an "App password", not the normal one)
//   SMTP_FROM   optional display name + address, e.g. "IIST Clubs <club@gmail.com>"
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.

import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_BATCH = 25;
const MAX_HTML = 200_000;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  // ---- who is calling? ----
  const auth = req.headers.get("Authorization") ?? "";
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await supa.auth.getUser();
  if (userErr || !userData?.user) return reply(401, { error: "Please sign in again." });

  // ---- what do they want? ----
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return reply(400, { error: "Bad JSON." }); }

  // ---- may they mail for this club? (the same has_perm the database policies use) ----
  const clubId = Number(p.club_id);
  if (!Number.isFinite(clubId)) return reply(400, { error: "club_id is missing." });
  const { data: allowed } = await supa.rpc("has_perm", { p_club: clubId, p_perm: "mail.send" });
  if (allowed !== true) return reply(403, { error: "You are not allowed to send mail for this club." });

  const subject = String(p.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const html = String(p.html ?? "");
  const text = String(p.text ?? "");
  if (!subject) return reply(400, { error: "Subject is empty." });
  if (!html || html.length > MAX_HTML) return reply(400, { error: "Mail body is empty or too large." });

  // ---- who gets it? ----
  let recipients: { name: string | null; email: string }[] = [];
  if (p.test === true) {
    // A test mail only ever goes to the admin who asked for it (never to a client-supplied address).
    const me = userData.user.email;
    if (!me) return reply(400, { error: "Your account has no e-mail address." });
    recipients = [{ name: null, email: me }];
  } else {
    const listId = Number(p.list_id);
    const offset = Math.max(0, Math.floor(Number(p.offset) || 0));
    const limit = Math.min(MAX_BATCH, Math.max(1, Math.floor(Number(p.limit) || 10)));
    if (!Number.isFinite(listId)) return reply(400, { error: "list_id is missing." });
    // The list must belong to the club the permission was checked for.
    const { data: list } = await supa.from("mailing_lists").select("id").eq("id", listId).eq("club_id", clubId).maybeSingle();
    if (!list) return reply(404, { error: "That list does not belong to this club." });
    const { data, error } = await supa
      .from("mailing_list_members")
      .select("name,email")
      .eq("list_id", listId)
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) return reply(500, { error: "Could not read the list: " + error.message });
    recipients = data ?? [];
  }

  // ---- SMTP ----
  const host = Deno.env.get("SMTP_HOST");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!host || !user || !pass) {
    return reply(500, { error: "SMTP is not set up yet. Add SMTP_HOST, SMTP_USER and SMTP_PASS as Edge Function secrets." });
  }
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");
  const from = Deno.env.get("SMTP_FROM") || user;

  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];
  if (recipients.length === 0) return reply(200, { sent: 0, failed: [], count: 0 });

  const client = new SMTPClient({
    connection: { hostname: host, port, tls: port === 465, auth: { username: user, password: pass } },
  });
  try {
    for (const r of recipients) {
      if (!EMAIL_RE.test(r.email)) { failed.push({ email: r.email, error: "Not a valid address" }); continue; }
      try {
        await client.send({ from, to: r.email, subject, content: text || "Please view this e-mail in an HTML-capable client.", html });
        sent.push(r.email);
      } catch (e) {
        failed.push({ email: r.email, error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
  return reply(200, { sent: sent.length, failed, count: recipients.length });
});
