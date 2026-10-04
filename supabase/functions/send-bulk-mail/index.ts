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

  const auth = req.headers.get("Authorization") ?? "";
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await supa.auth.getUser();
  if (userErr || !userData?.user) return reply(401, { error: "Please sign in again." });

  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return reply(400, { error: "Bad JSON." }); }

  const clubId = Number(p.club_id);
  if (!Number.isFinite(clubId)) return reply(400, { error: "club_id is missing." });
  const { data: allowed } = await supa.rpc("has_perm", { p_club: clubId, p_perm: "mail.send" });
  if (allowed !== true) return reply(403, { error: "You are not allowed to send mail for this club." });

  const subject = String(p.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const html = String(p.html ?? "");
  const text = String(p.text ?? "");
  if (!subject) return reply(400, { error: "Subject is empty." });
  if (!html || html.length > MAX_HTML) return reply(400, { error: "Mail body is empty or too large." });

  let recipients: { name: string | null; email: string }[] = [];
  if (p.test === true) {

    const me = userData.user.email;
    if (!me) return reply(400, { error: "Your account has no e-mail address." });
    recipients = [{ name: null, email: me }];
  } else {
    const listId = Number(p.list_id);
    const offset = Math.max(0, Math.floor(Number(p.offset) || 0));
    const limit = Math.min(MAX_BATCH, Math.max(1, Math.floor(Number(p.limit) || 10)));
    if (!Number.isFinite(listId)) return reply(400, { error: "list_id is missing." });

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

  if (p.test !== true && recipients.length > 0) {
    const { data: granted, error: quotaErr } = await supa.rpc("mail_quota_take", { p_club: clubId, p_n: recipients.length });
    if (quotaErr) return reply(500, { error: "Could not check the daily mail limit: " + quotaErr.message });
    const allowedNow = Number(granted ?? 0);
    if (allowedNow <= 0) return reply(429, { error: "The daily limit for sending e-mail has been reached for this club. Try again tomorrow." });
    recipients = recipients.slice(0, allowedNow);
  }

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
    try { await client.close(); } catch {   }
  }
  return reply(200, { sent: sent.length, failed, count: recipients.length });
});
