import { supabase } from "./supabaseClient";

/* Cada función aquí hace UNA cosa contra Supabase. App.jsx las combina. */

export async function getOrCreateCompany(userId) {
  const { data: existing, error: selErr } = await supabase
    .from("companies")
    .select("*")
    .eq("owner_id", userId)
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing;

  const { data: created, error: insErr } = await supabase
    .from("companies")
    .insert({ owner_id: userId, name: "Mi Empresa S.A.S." })
    .select()
    .single();
  if (insErr) throw insErr;
  return created;
}

export async function updateCompany(companyId, patch) {
  const { error } = await supabase.from("companies").update(patch).eq("id", companyId);
  if (error) throw error;
}

export async function fetchAccounts(companyId) {
  const { data, error } = await supabase
    .from("accounts")
    .select("code, name, class, nature")
    .eq("company_id", companyId)
    .order("code");
  if (error) throw error;
  return data;
}

export async function insertAccount(companyId, account) {
  const { error } = await supabase.from("accounts").insert({
    company_id: companyId,
    code: account.code,
    name: account.name,
    class: account.class,
    nature: account.nature,
  });
  if (error) throw error;
}

export async function deleteAccount(companyId, code) {
  const { error } = await supabase.from("accounts").delete().eq("company_id", companyId).eq("code", code);
  if (error) throw error;
}

export async function fetchEntries(companyId) {
  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, number, date, description, journal_lines(account_code, debit, credit)")
    .eq("company_id", companyId)
    .order("number");
  if (error) throw error;
  return data.map((e) => ({
    id: e.id,
    number: e.number,
    date: e.date,
    description: e.description,
    lines: (e.journal_lines || []).map((l) => ({
      accountCode: l.account_code,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
    })),
  }));
}

export async function insertEntry(companyId, entry) {
  const { data: created, error } = await supabase
    .from("journal_entries")
    .insert({ company_id: companyId, number: entry.number, date: entry.date, description: entry.description })
    .select()
    .single();
  if (error) throw error;

  const lines = entry.lines.map((l) => ({
    entry_id: created.id,
    account_code: l.accountCode,
    debit: l.debit,
    credit: l.credit,
  }));
  const { error: linesErr } = await supabase.from("journal_lines").insert(lines);
  if (linesErr) throw linesErr;
  return created.id;
}

export async function fetchInvoices(companyId) {
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, number, date, client_name, client_nit, payment_type, subtotal, iva, total, status, journal_entry_id, invoice_items(description, qty, price)"
    )
    .eq("company_id", companyId)
    .order("number");
  if (error) throw error;
  return data.map((i) => ({
    id: i.id,
    number: i.number,
    date: i.date,
    client: { name: i.client_name, nit: i.client_nit },
    paymentType: i.payment_type,
    items: (i.invoice_items || []).map((it) => ({
      desc: it.description,
      qty: Number(it.qty),
      price: Number(it.price),
    })),
    subtotal: Number(i.subtotal),
    iva: Number(i.iva),
    total: Number(i.total),
    status: i.status,
    journalEntryId: i.journal_entry_id,
  }));
}

export async function insertInvoice(companyId, invoice) {
  const { data: created, error } = await supabase
    .from("invoices")
    .insert({
      company_id: companyId,
      number: invoice.number,
      date: invoice.date,
      client_name: invoice.client.name,
      client_nit: invoice.client.nit,
      payment_type: invoice.paymentType,
      subtotal: invoice.subtotal,
      iva: invoice.iva,
      total: invoice.total,
      status: "borrador",
    })
    .select()
    .single();
  if (error) throw error;

  const items = invoice.items.map((it) => ({
    invoice_id: created.id,
    description: it.desc,
    qty: it.qty,
    price: it.price,
  }));
  const { error: itemsErr } = await supabase.from("invoice_items").insert(items);
  if (itemsErr) throw itemsErr;
  return created.id;
}

export async function markInvoicePosted(invoiceId, journalEntryId) {
  const { error } = await supabase
    .from("invoices")
    .update({ status: "contabilizada", journal_entry_id: journalEntryId })
    .eq("id", invoiceId);
  if (error) throw error;
}
