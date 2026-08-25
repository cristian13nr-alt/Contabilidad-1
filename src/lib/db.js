import { supabase } from "./supabaseClient";

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

export async function fetchVoucherTypes(companyId) {
  const { data, error } = await supabase
    .from("voucher_types")
    .select("id, name, prefix")
    .eq("company_id", companyId)
    .order("prefix");
  if (error) throw error;
  return data;
}

export async function insertVoucherType(companyId, type) {
  const { error } = await supabase.from("voucher_types").insert({
    company_id: companyId,
    name: type.name,
    prefix: type.prefix,
  });
  if (error) throw error;
}

export async function deleteVoucherType(companyId, id) {
  const { error } = await supabase.from("voucher_types").delete().eq("company_id", companyId).eq("id", id);
  if (error) throw error;
}

export async function fetchThirdParties(companyId) {
  const { data, error } = await supabase
    .from("third_parties")
    .select("id, name, nit, type, email, phone")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw error;
  return data;
}

export async function insertThirdParty(companyId, tp) {
  const { error } = await supabase.from("third_parties").insert({
    company_id: companyId,
    name: tp.name,
    nit: tp.nit,
    type: tp.type,
    email: tp.email || null,
    phone: tp.phone || null,
  });
  if (error) throw error;
}

export async function deleteThirdParty(companyId, id) {
  const { error } = await supabase.from("third_parties").delete().eq("company_id", companyId).eq("id", id);
  if (error) throw error;
}
export async function fetchEntries(companyId) {
  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, number, date, description, voucher_type_id, voucher_types(name, prefix), journal_lines(account_code, debit, credit)")
    .eq("company_id", companyId)
    .order("number");
  if (error) throw error;
  return data.map((e) => ({
    id: e.id,
    number: e.number,
    date: e.date,
    description: e.description,
    voucherTypeId: e.voucher_type_id,
    voucherTypeName: e.voucher_types ? e.voucher_types.name : null,
    voucherTypePrefix: e.voucher_types ? e.voucher_types.prefix : null,
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
    .insert({
      company_id: companyId,
      number: entry.number,
      date: entry.date,
      description: entry.description,
      voucher_type_id: entry.voucherTypeId || null,
    })
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
      "id, number, date, client_name, client_nit, payment_type, subtotal, iva, retencion_rate, retencion_value, total, status, journal_entry_id, invoice_items(description, qty, price)"
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
    retencionRate: Number(i.retencion_rate) || 0,
    retencionValue: Number(i.retencion_value) || 0,
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
      retencion_rate: invoice.retencionRate || 0,
      retencion_value: invoice.retencionValue || 0,
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

export async function fetchPurchases(companyId) {
  const { data, error } = await supabase
    .from("purchases")
    .select(
      "id, number, date, provider_name, provider_nit, payment_type, expense_account, subtotal, iva, total, status, journal_entry_id, purchase_items(description, qty, price)"
    )
    .eq("company_id", companyId)
    .order("number");
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    number: p.number,
    date: p.date,
    provider: { name: p.provider_name, nit: p.provider_nit },
    paymentType: p.payment_type,
    expenseAccount: p.expense_account,
    items: (p.purchase_items || []).map((it) => ({
      desc: it.description,
      qty: Number(it.qty),
      price: Number(it.price),
    })),
    subtotal: Number(p.subtotal),
    iva: Number(p.iva),
    total: Number(p.total),
    status: p.status,
    journalEntryId: p.journal_entry_id,
  }));
}

export async function insertPurchase(companyId, purchase) {
  const { data: created, error } = await supabase
    .from("purchases")
    .insert({
      company_id: companyId,
      number: purchase.number,
      date: purchase.date,
      provider_name: purchase.provider.name,
      provider_nit: purchase.provider.nit,
      payment_type: purchase.paymentType,
      expense_account: purchase.expenseAccount,
      subtotal: purchase.subtotal,
      iva: purchase.iva,
      total: purchase.total,
      status: "borrador",
    })
    .select()
    .single();
  if (error) throw error;

  const items = purchase.items.map((it) => ({
    purchase_id: created.id,
    description: it.desc,
    qty: it.qty,
    price: it.price,
  }));
  const { error: itemsErr } = await supabase.from("purchase_items").insert(items);
  if (itemsErr) throw itemsErr;
  return created.id;
}

export async function markPurchasePosted(purchaseId, journalEntryId) {
  const { error } = await supabase
    .from("purchases")
    .update({ status: "contabilizada", journal_entry_id: journalEntryId })
    .eq("id", purchaseId);
  if (error) throw error;
}
