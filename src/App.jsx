import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard, BookOpen, ScrollText, Scale, FileText, Receipt,
  Plus, Trash2, Printer, X, Check, AlertTriangle, Search, Settings2,
  Landmark, ChevronRight, Loader2, LogOut, Users, ShoppingBag, Download, Calculator
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabaseClient";
import Auth from "./Auth";
import {
  getOrCreateCompany, updateCompany,
  fetchAccounts, insertAccount, deleteAccount,
  fetchEntries, insertEntry,
  fetchInvoices, insertInvoice, markInvoicePosted, fetchVoucherTypes, insertVoucherType, deleteVoucherType,
  fetchThirdParties, insertThirdParty, deleteThirdParty,
  fetchPurchases, insertPurchase, markPurchasePosted,
} from "./lib/db";

/* ───────────────────────── Datos base (plan de cuentas de referencia) ───────────────────────── */

const CLASS_NAMES = {
  "1": "Activo", "2": "Pasivo", "3": "Patrimonio",
  "4": "Ingresos", "5": "Gastos", "6": "Costos",
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtCOP = (n) =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0
  );
function exportToExcel(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  });
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
const fmtDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/* ───────────────────────── Cálculos contables puros ───────────────────── */

function accountMovements(entries, code) {
  const moves = [];
  entries.forEach((e) => {
    e.lines.forEach((l) => {
      if (l.accountCode === code && ((l.debit || 0) > 0 || (l.credit || 0) > 0)) {
        moves.push({ date: e.date, description: e.description, debit: l.debit || 0, credit: l.credit || 0, entryId: e.id, entryNo: e.number });
      }
    });
  });
  return moves.sort((a, b) => a.date.localeCompare(b.date));
}

function accountBalance(account, entries) {
  const moves = accountMovements(entries, account.code);
  const totalDebit = moves.reduce((s, m) => s + m.debit, 0);
  const totalCredit = moves.reduce((s, m) => s + m.credit, 0);
  const balance = account.nature === "debito" ? totalDebit - totalCredit : totalCredit - totalDebit;
  return { totalDebit, totalCredit, balance, moves };
}

function useFinancials(accounts, entries) {
  return useMemo(() => {
    const rows = accounts.map((a) => ({ ...a, ...accountBalance(a, entries) }));
    const withMovement = rows.filter((r) => r.totalDebit > 0 || r.totalCredit > 0);
    const byClass = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    rows.forEach((r) => { if (r.balance !== 0) byClass[r.class].push(r); });
    const sum = (arr) => arr.reduce((s, a) => s + a.balance, 0);
    const activo = sum(byClass["1"]);
    const pasivo = sum(byClass["2"]);
    const patrimonio = sum(byClass["3"]);
    const ingresos = sum(byClass["4"]);
    const gastos = sum(byClass["5"]);
    const costos = sum(byClass["6"]);
    const utilidad = ingresos - gastos - costos;
    return { rows, withMovement, byClass, activo, pasivo, patrimonio, ingresos, gastos, costos, utilidad };
  }, [accounts, entries]);
}

/* ───────────────────────── Piezas de UI compartidas ────────────────────── */

function Money({ value, className = "" }) {
  const neg = value < 0;
  return (
    <span className={`mono ${neg ? "text-ink-red" : ""} ${className}`}>
      {neg ? "(" : ""}{fmtCOP(Math.abs(value))}{neg ? ")" : ""}
    </span>
  );
}

function Card({ title, children, right }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="empty-state">
      <Icon size={28} strokeWidth={1.5} />
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  );
}

/* ───────────────────────── Dashboard ───────────────────────── */

function Dashboard({ accounts, entries, invoices }) {
  const fin = useFinancials(accounts, entries);
  const balanced = Math.abs(fin.activo - (fin.pasivo + fin.patrimonio + fin.utilidad)) < 1;

  const monthly = useMemo(() => {
    const map = {};
    entries.forEach((e) => {
      const key = e.date.slice(0, 7);
      if (!map[key]) map[key] = { ingresos: 0, gastos: 0 };
      e.lines.forEach((l) => {
        const acc = accounts.find((a) => a.code === l.accountCode);
        if (!acc) return;
        if (acc.class === "4") map[key].ingresos += (l.credit || 0) - (l.debit || 0);
        if (acc.class === "5" || acc.class === "6") map[key].gastos += (l.debit || 0) - (l.credit || 0);
      });
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([k, v]) => ({ mes: k, ...v }));
  }, [entries, accounts]);

  const maxMonthly = Math.max(1, ...monthly.map((m) => Math.max(m.ingresos, m.gastos)));

  return (
    <div className="stack-lg">
      <div className="kpi-grid">
        <Card title="Activo total"><Money value={fin.activo} className="kpi-value" /></Card>
        <Card title="Pasivo total"><Money value={fin.pasivo} className="kpi-value" /></Card>
        <Card title="Patrimonio + Resultado"><Money value={fin.patrimonio + fin.utilidad} className="kpi-value" /></Card>
        <Card title={fin.utilidad >= 0 ? "Utilidad del periodo" : "Pérdida del periodo"}>
          <Money value={fin.utilidad} className={`kpi-value ${fin.utilidad >= 0 ? "text-ink-green" : "text-ink-red"}`} />
        </Card>
      </div>

      <div className="two-col">
        <Card title="Ingresos vs. gastos (últimos meses)">
          {monthly.length === 0 ? (
            <EmptyState icon={ScrollText} title="Aún no hay movimientos" hint="Registra un comprobante contable para ver la tendencia." />
          ) : (
            <div className="bars">
              {monthly.map((m) => (
                <div className="bar-col" key={m.mes}>
                  <div className="bar-pair">
                    <div className="bar bar-green" style={{ height: `${(m.ingresos / maxMonthly) * 100}%` }} title={`Ingresos ${fmtCOP(m.ingresos)}`} />
                    <div className="bar bar-red" style={{ height: `${(m.gastos / maxMonthly) * 100}%` }} title={`Gastos ${fmtCOP(m.gastos)}`} />
                  </div>
                  <span className="bar-label">{m.mes.slice(5)}/{m.mes.slice(2, 4)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="legend">
            <span><i className="dot dot-green" /> Ingresos</span>
            <span><i className="dot dot-red" /> Gastos + costos</span>
          </div>
        </Card>

        <Card title="Estado de la partida doble">
          <div className={`stamp-big ${balanced ? "stamp-ok" : "stamp-bad"}`}>
            {balanced ? <Check size={32} /> : <AlertTriangle size={32} />}
            <div>
              <div className="stamp-title">{balanced ? "LIBROS CUADRADOS" : "DESCUADRE"}</div>
              <div className="stamp-sub">Activo {fmtCOP(fin.activo)} — Pasivo + Patrimonio {fmtCOP(fin.pasivo + fin.patrimonio + fin.utilidad)}</div>
            </div>
          </div>
          <div className="mini-stats">
            <div><span>Comprobantes</span><strong className="mono">{entries.length}</strong></div>
            <div><span>Cuentas con movimiento</span><strong className="mono">{fin.withMovement.length}</strong></div>
            <div><span>Facturas emitidas</span><strong className="mono">{invoices.length}</strong></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────── Plan de cuentas ───────────────────────── */

function ChartOfAccounts({ accounts, entries, onAdd, onRemove }) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ code: "", name: "", class: "1", nature: "debito" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = accounts.filter(
    (a) => a.code.includes(query) || a.name.toLowerCase().includes(query.toLowerCase())
  );

  const addAccount = async () => {
    setError("");
    if (!/^\d{4,6}$/.test(form.code)) return setError("El código debe tener entre 4 y 6 dígitos (PUC).");
    if (!form.name.trim()) return setError("Escribe un nombre para la cuenta.");
    if (accounts.some((a) => a.code === form.code)) return setError("Ese código ya existe.");
    setBusy(true);
    try {
      await onAdd({ ...form, name: form.name.trim() });
      setForm({ code: "", name: "", class: form.class, nature: form.nature });
    } catch (e) {
      setError(e.message || "No se pudo guardar la cuenta.");
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (code) => {
    setError("");
    const used = entries.some((e) => e.lines.some((l) => l.accountCode === code));
    if (used) return setError("No puedes borrar una cuenta con movimientos registrados.");
    try {
      await onRemove(code);
    } catch (e) {
      setError(e.message || "No se pudo eliminar la cuenta.");
    }
  };

  return (
    <div className="stack-lg">
      <Card title="Nueva cuenta" right={<span className="hint-text">Plan Único de Cuentas (PUC) simplificado</span>}>
        <div className="form-row">
          <input className="input input-sm" placeholder="Código (ej. 5195)" value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })} maxLength={6} />
          <input className="input" placeholder="Nombre de la cuenta" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input input-sm" value={form.class}
            onChange={(e) => {
              const cls = e.target.value;
              const nature = cls === "1" || cls === "5" || cls === "6" ? "debito" : "credito";
              setForm({ ...form, class: cls, nature });
            }}>
            {Object.entries(CLASS_NAMES).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
          </select>
          <span className="nature-pill">{form.nature === "debito" ? "Naturaleza débito" : "Naturaleza crédito"}</span>
          <button className="btn btn-primary" onClick={addAccount} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Agregar
          </button>
        </div>
        {error && <p className="error-text"><AlertTriangle size={14} /> {error}</p>}
      </Card>

      <Card
        title="Cuentas"
        right={
          <div className="search-box">
            <Search size={14} />
            <input placeholder="Buscar código o nombre…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        }
      >
        <table className="ledger-table">
          <thead><tr><th>Código</th><th>Nombre</th><th>Clase</th><th>Naturaleza</th><th></th></tr></thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.code}>
                <td className="mono">{a.code}</td>
                <td>{a.name}</td>
                <td>{CLASS_NAMES[a.class]}</td>
                <td className="capitalize">{a.nature}</td>
                <td className="text-right">
                  <button className="icon-btn" title="Eliminar" onClick={() => removeAccount(a.code)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5}><EmptyState icon={Search} title="Sin resultados" /></td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
/* ───────────────────────── Terceros (Clientes y Proveedores) ───────────────────────── */

function emptyThirdPartyForm() { return { name: "", nit: "", type: "cliente", email: "", phone: "" }; }

function ThirdParties({ thirdParties, onAdd, onRemove }) {
  const [form, setForm] = useState(emptyThirdPartyForm());
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = thirdParties.filter((t) => {
    const matchesType = filterType === "all" || t.type === filterType || t.type === "ambos";
    const matchesQuery = t.name.toLowerCase().includes(query.toLowerCase()) || t.nit.includes(query);
    return matchesType && matchesQuery;
  });

  const add = async () => {
    setError("");
    if (!form.name.trim()) return setError("Escribe un nombre o razón social.");
    if (!form.nit.trim()) return setError("Escribe el NIT o cédula.");
    setBusy(true);
    try {
      await onAdd({ name: form.name.trim(), nit: form.nit.trim(), type: form.type, email: form.email.trim(), phone: form.phone.trim() });
      setForm(emptyThirdPartyForm());
    } catch (e) {
      setError(e.message || "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setError("");
    try {
      await onRemove(id);
    } catch (e) {
      setError(e.message || "No se pudo eliminar (puede estar en uso).");
    }
  };

  const typeLabel = (t) => (t === "cliente" ? "Cliente" : t === "proveedor" ? "Proveedor" : "Cliente y proveedor");

  return (
    <div className="stack-lg">
      <Card title="Nuevo tercero">
        <div className="form-row">
          <input className="input" placeholder="Nombre o razón social" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input input-sm" placeholder="NIT / Cédula" value={form.nit}
            onChange={(e) => setForm({ ...form, nit: e.target.value })} />
          <select className="input input-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="cliente">Cliente</option>
            <option value="proveedor">Proveedor</option>
            <option value="ambos">Cliente y proveedor</option>
          </select>
        </div>
        <div className="form-row">
          <input className="input" placeholder="Correo (opcional)" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input" placeholder="Teléfono (opcional)" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <button className="btn btn-primary" onClick={add} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Agregar
          </button>
        </div>
        {error && <p className="error-text"><AlertTriangle size={14} /> {error}</p>}
      </Card>

      <Card
        title="Terceros"
        right={
          <div className="form-row" style={{ marginBottom: 0 }}>
            <select className="input input-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">Todos</option>
              <option value="cliente">Clientes</option>
              <option value="proveedor">Proveedores</option>
            </select>
            <div className="search-box">
              <Search size={14} />
              <input placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        }
      >
        <table className="ledger-table">
          <thead><tr><th>Nombre</th><th>NIT</th><th>Tipo</th><th>Contacto</th><th></th></tr></thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="mono">{t.nit}</td>
                <td>{typeLabel(t.type)}</td>
                <td>{[t.email, t.phone].filter(Boolean).join(" · ") || "—"}</td>
                <td className="text-right">
                  <button className="icon-btn" title="Eliminar" onClick={() => remove(t.id)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5}><EmptyState icon={Users} title="Aún no tienes terceros registrados" /></td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
/* ───────────────────────── Comprobantes / Partida doble ───────────────────────── */

function emptyLine() { return { id: uid(), accountCode: "", debit: "", credit: "" }; }

function JournalEntries({ accounts, entries, voucherTypes, onSubmit }) {
  const [date, setDate] = useState(todayISO());
  const [voucherTypeId, setVoucherTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [filterType, setFilterType] = useState("all");

  useEffect(() => {
    if (!voucherTypeId && voucherTypes.length) setVoucherTypeId(voucherTypes[0].id);
  }, [voucherTypes, voucherTypeId]);

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  const updateLine = (id, patch) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines([...lines, emptyLine()]);
  const removeLine = (id) => lines.length > 2 && setLines(lines.filter((l) => l.id !== id));

  const submit = async () => {
    setError("");
    if (!voucherTypeId) return setError("Selecciona un tipo de comprobante (créalos en Ajustes si no ves ninguno).");
    if (!description.trim()) return setError("Describe el comprobante.");
    if (lines.some((l) => !l.accountCode)) return setError("Selecciona una cuenta en cada línea.");
    if (!balanced) return setError("El comprobante no cuadra: Debe y Haber deben ser iguales y mayores a cero.");
    setBusy(true);
    try {
      await onSubmit({
        voucherTypeId,
        date,
        description: description.trim(),
        lines: lines.map((l) => ({ accountCode: l.accountCode, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 })),
      });
      setDescription("");
      setLines([emptyLine(), emptyLine()]);
    } catch (e) {
      setError(e.message || "No se pudo contabilizar.");
    } finally {
      setBusy(false);
    }
  };

  const accountLabel = (code) => {
    const a = accounts.find((x) => x.code === code);
    return a ? `${a.code} · ${a.name}` : code;
  };

  const entryLabel = (e) => {
    const prefix = e.voucherTypePrefix || "CO";
    return `${prefix}-${String(e.number).padStart(4, "0")}`;
  };

  const filteredEntries = filterType === "all" ? entries : entries.filter((e) => e.voucherTypeId === filterType);

  return (
    <div className="stack-lg">
      <Card title="Nuevo comprobante contable" right={voucherTypes.length === 0 ? <span className="hint-text">Crea tipos de comprobante en Ajustes</span> : null}>
        <div className="form-row">
          <select className="input input-sm" value={voucherTypeId} onChange={(e) => setVoucherTypeId(e.target.value)}>
            <option value="">Tipo de comprobante…</option>
            {voucherTypes.map((t) => <option key={t.id} value={t.id}>{t.prefix} · {t.name}</option>)}
          </select>
          <input type="date" className="input input-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          <input className="input" placeholder="Descripción (ej. Pago de arriendo agosto)" value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>

        <table className="ledger-table entry-table">
          <thead><tr><th>Cuenta</th><th className="text-right">Débito</th><th className="text-right">Crédito</th><th></th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <select className="input" value={l.accountCode} onChange={(e) => updateLine(l.id, { accountCode: e.target.value })}>
                    <option value="">Selecciona cuenta…</option>
                    {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                  </select>
                </td>
                <td><input className="input input-sm text-right mono" type="number" min="0" placeholder="0"
                  value={l.debit} onChange={(e) => updateLine(l.id, { debit: e.target.value, credit: "" })} /></td>
                <td><input className="input input-sm text-right mono" type="number" min="0" placeholder="0"
                  value={l.credit} onChange={(e) => updateLine(l.id, { credit: e.target.value, debit: "" })} /></td>
                <td><button className="icon-btn" onClick={() => removeLine(l.id)} disabled={lines.length <= 2}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><button className="btn btn-ghost btn-sm" onClick={addLine}><Plus size={14} /> Línea</button></td>
              <td className="text-right mono">{fmtCOP(totalDebit)}</td>
              <td className="text-right mono">{fmtCOP(totalCredit)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <div className="entry-footer">
          <div className={`stamp-inline ${balanced ? "stamp-ok" : "stamp-bad"}`}>
            {balanced ? <Check size={16} /> : <AlertTriangle size={16} />}
            {balanced ? "Cuadrado" : "Descuadrado"}
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : "Contabilizar"}
          </button>
        </div>
        {error && <p className="error-text"><AlertTriangle size={14} /> {error}</p>}
      </Card>

      <Card
        title="Comprobantes registrados"
        right={
          <select className="input input-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">Todos los tipos</option>
            {voucherTypes.map((t) => <option key={t.id} value={t.id}>{t.prefix} · {t.name}</option>)}
          </select>
        }
      >
        {filteredEntries.length === 0 ? (
          <EmptyState icon={ScrollText} title="Sin comprobantes todavía" hint="El primer asiento que registres aparecerá aquí." />
        ) : (
          <div className="entries-list">
            {[...filteredEntries].reverse().map((e) => (
              <div className="entry-item" key={e.id}>
                <button className="entry-item-head" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                  <span className="mono entry-no">{entryLabel(e)}</span>
                  <span className="entry-date">{fmtDate(e.date)}</span>
                  <span className="entry-desc">{e.description}</span>
                  <span className="mono entry-total">{fmtCOP(e.lines.reduce((s, l) => s + l.debit, 0))}</span>
                  <ChevronRight size={16} className={`chev ${expanded === e.id ? "chev-open" : ""}`} />
                </button>
                {expanded === e.id && (
                  <table className="ledger-table nested">
                    <thead><tr><th>Cuenta</th><th className="text-right">Débito</th><th className="text-right">Crédito</th></tr></thead>
                    <tbody>
                      {e.lines.map((l, i) => (
                        <tr key={i}>
                          <td>{accountLabel(l.accountCode)}</td>
                          <td className="text-right mono">{l.debit ? fmtCOP(l.debit) : "—"}</td>
                          <td className="text-right mono">{l.credit ? fmtCOP(l.credit) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ───────────────────────── Libro mayor ───────────────────────── */

function Ledger({ accounts, entries }) {
  const withMovement = accounts.filter((a) => accountMovements(entries, a.code).length > 0);
  const [selected, setSelected] = useState("");
  useEffect(() => { if (!selected && withMovement.length) setSelected(withMovement[0].code); }, [withMovement, selected]);

  const account = accounts.find((a) => a.code === selected);
  const moves = account ? accountMovements(entries, account.code) : [];

  let running = 0;
  const rows = moves.map((m) => {
    const delta = account.nature === "debito" ? m.debit - m.credit : m.credit - m.debit;
    running += delta;
    return { ...m, running };
  });

  const exportExcel = () => {
    const exportRows = rows.map((m) => ({
      Fecha: fmtDate(m.date), Comprobante: `#${String(m.entryNo).padStart(4, "0")}`,
      Descripción: m.description, Débito: m.debit, Crédito: m.credit, Saldo: m.running,
    }));
    exportToExcel(`libro-mayor-${account?.code || ""}`, [{ name: account?.name || "Libro mayor", rows: exportRows }]);
  };

  return (
    <div className="stack-lg">
      <Card title="Libro mayor por cuenta" right={rows.length > 0 ? (
        <button className="btn btn-ghost btn-sm" onClick={exportExcel}><Download size={14} /> Excel</button>
      ) : null}>
        {withMovement.length === 0 ? (
          <EmptyState icon={BookOpen} title="Todavía no hay movimientos" hint="Registra comprobantes en la sección Comprobantes." />
        ) : (
          <>
            <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {withMovement.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select>
            <table className="ledger-table" style={{ marginTop: 12 }}>
              <thead><tr><th>Fecha</th><th>Comprobante</th><th>Descripción</th><th className="text-right">Débito</th><th className="text-right">Crédito</th><th className="text-right">Saldo</th></tr></thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr key={i}>
                    <td>{fmtDate(m.date)}</td>
                    <td className="mono">#{String(m.entryNo).padStart(4, "0")}</td>
                    <td>{m.description}</td>
                    <td className="text-right mono">{m.debit ? fmtCOP(m.debit) : "—"}</td>
                    <td className="text-right mono">{m.credit ? fmtCOP(m.credit) : "—"}</td>
                    <td className="text-right mono"><Money value={m.running} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}

/* ───────────────────────── Balance de comprobación ───────────────────────── */

function TrialBalance({ accounts, entries }) {
  const fin = useFinancials(accounts, entries);
  const totalDebit = fin.withMovement.reduce((s, r) => s + r.totalDebit, 0);
  const totalCredit = fin.withMovement.reduce((s, r) => s + r.totalCredit, 0);

  const exportExcel = () => {
    const rows = fin.withMovement.sort((a, b) => a.code.localeCompare(b.code)).map((r) => ({
      Código: r.code, Cuenta: r.name, Débitos: r.totalDebit, Créditos: r.totalCredit, Saldo: r.balance,
    }));
    exportToExcel("balance-de-prueba", [{ name: "Balance de prueba", rows }]);
  };

  return (
    <Card title="Balance de comprobación" right={fin.withMovement.length > 0 ? (
      <button className="btn btn-ghost btn-sm" onClick={exportExcel}><Download size={14} /> Excel</button>
    ) : null}>
      {fin.withMovement.length === 0 ? (
        <EmptyState icon={Scale} title="No hay saldos que mostrar aún" />
      ) : (
        <table className="ledger-table">
          <thead><tr><th>Código</th><th>Cuenta</th><th className="text-right">Débitos</th><th className="text-right">Créditos</th><th className="text-right">Saldo</th></tr></thead>
          <tbody>
            {fin.withMovement.sort((a, b) => a.code.localeCompare(b.code)).map((r) => (
              <tr key={r.code}>
                <td className="mono">{r.code}</td>
                <td>{r.name}</td>
                <td className="text-right mono">{fmtCOP(r.totalDebit)}</td>
                <td className="text-right mono">{fmtCOP(r.totalCredit)}</td>
                <td className="text-right mono"><Money value={r.balance} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="totals-row">
              <td colSpan={2}>Totales</td>
              <td className="text-right mono">{fmtCOP(totalDebit)}</td>
              <td className="text-right mono">{fmtCOP(totalCredit)}</td>
              <td className="text-right">
                {Math.abs(totalDebit - totalCredit) < 1
                  ? <span className="stamp-inline stamp-ok"><Check size={14} /> Cuadrado</span>
                  : <span className="stamp-inline stamp-bad"><AlertTriangle size={14} /> Revisar</span>}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </Card>
  );
}

/* ───────────────────────── Estados financieros ───────────────────────── */

function FinancialStatements({ accounts, entries }) {
  const fin = useFinancials(accounts, entries);
  const section = (cls) => fin.byClass[cls].sort((a, b) => a.code.localeCompare(b.code));

  const exportExcel = () => {
    const balanceRows = [
      ...section("1").map((a) => ({ Sección: "Activo", Cuenta: a.name, Saldo: a.balance })),
      { Sección: "Activo", Cuenta: "TOTAL ACTIVO", Saldo: fin.activo },
      ...section("2").map((a) => ({ Sección: "Pasivo", Cuenta: a.name, Saldo: a.balance })),
      { Sección: "Pasivo", Cuenta: "TOTAL PASIVO", Saldo: fin.pasivo },
      ...section("3").map((a) => ({ Sección: "Patrimonio", Cuenta: a.name, Saldo: a.balance })),
      { Sección: "Patrimonio", Cuenta: "Resultado del ejercicio", Saldo: fin.utilidad },
      { Sección: "Patrimonio", Cuenta: "TOTAL PATRIMONIO", Saldo: fin.patrimonio + fin.utilidad },
    ];
    const resultRows = [
      ...section("4").map((a) => ({ Sección: "Ingresos", Cuenta: a.name, Saldo: a.balance })),
      { Sección: "Ingresos", Cuenta: "TOTAL INGRESOS", Saldo: fin.ingresos },
      ...section("6").map((a) => ({ Sección: "Costos", Cuenta: a.name, Saldo: -a.balance })),
      ...section("5").map((a) => ({ Sección: "Gastos", Cuenta: a.name, Saldo: -a.balance })),
      { Sección: "Resultado", Cuenta: fin.utilidad >= 0 ? "UTILIDAD NETA" : "PÉRDIDA NETA", Saldo: fin.utilidad },
    ];
    exportToExcel("estados-financieros", [
      { name: "Balance general", rows: balanceRows },
      { name: "Estado de resultados", rows: resultRows },
    ]);
  };

  return (
    <div className="stack-lg">
      <div className="entry-footer">
        <span />
        <button className="btn btn-ghost btn-sm" onClick={exportExcel}><Download size={14} /> Excel</button>
      </div>
      <div className="two-col">
      <Card title="Balance general">
        <p className="statement-label">Activo</p>
        {section("1").map((a) => (
          <div className="statement-row" key={a.code}><span>{a.name}</span><Money value={a.balance} /></div>
        ))}
        <div className="statement-row statement-total"><span>Total activo</span><Money value={fin.activo} /></div>

        <p className="statement-label" style={{ marginTop: 16 }}>Pasivo</p>
        {section("2").map((a) => (
          <div className="statement-row" key={a.code}><span>{a.name}</span><Money value={a.balance} /></div>
        ))}
        <div className="statement-row statement-total"><span>Total pasivo</span><Money value={fin.pasivo} /></div>

        <p className="statement-label" style={{ marginTop: 16 }}>Patrimonio</p>
        {section("3").map((a) => (
          <div className="statement-row" key={a.code}><span>{a.name}</span><Money value={a.balance} /></div>
        ))}
        <div className="statement-row"><span>Resultado del ejercicio (sin cerrar)</span><Money value={fin.utilidad} /></div>
        <div className="statement-row statement-total"><span>Total patrimonio</span><Money value={fin.patrimonio + fin.utilidad} /></div>

        <div className="statement-row statement-check">
          <span>Activo = Pasivo + Patrimonio</span>
          {Math.abs(fin.activo - (fin.pasivo + fin.patrimonio + fin.utilidad)) < 1
            ? <span className="stamp-inline stamp-ok"><Check size={14} /> Cuadra</span>
            : <span className="stamp-inline stamp-bad"><AlertTriangle size={14} /> No cuadra</span>}
        </div>
      </Card>

      <Card title="Estado de resultados">
        <p className="statement-label">Ingresos</p>
        {section("4").map((a) => (
          <div className="statement-row" key={a.code}><span>{a.name}</span><Money value={a.balance} /></div>
        ))}
        <div className="statement-row statement-total"><span>Total ingresos</span><Money value={fin.ingresos} /></div>

        <p className="statement-label" style={{ marginTop: 16 }}>Costos</p>
        {section("6").length === 0 && <div className="statement-row muted"><span>Sin movimientos</span></div>}
        {section("6").map((a) => (
          <div className="statement-row" key={a.code}><span>{a.name}</span><Money value={-a.balance} /></div>
        ))}

        <p className="statement-label" style={{ marginTop: 16 }}>Gastos</p>
        {section("5").map((a) => (
          <div className="statement-row" key={a.code}><span>{a.name}</span><Money value={-a.balance} /></div>
        ))}

                <div className={`statement-row statement-total ${fin.utilidad >= 0 ? "text-ink-green" : "text-ink-red"}`}>
          <span>{fin.utilidad >= 0 ? "Utilidad neta" : "Pérdida neta"}</span><Money value={fin.utilidad} />
        </div>
      </Card>
    </div>
    </div>
  );
}

/* ───────────────────────── Facturación ───────────────────────── */

function emptyItem() { return { id: uid(), desc: "", qty: 1, price: "" }; }

function Invoicing({ entries, invoices, settings, thirdParties, onCreateInvoice, onPostInvoice }) {
  const [query, setQuery] = useState("");
  const [client, setClient] = useState({ name: "", nit: "" });
  const [date, setDate] = useState(todayISO());
  const [paymentType, setPaymentType] = useState("credito");
  const [items, setItems] = useState([emptyItem()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postingId, setPostingId] = useState(null);
  const [printing, setPrinting] = useState(null);
  const printRef = useRef(null);

  const updateItem = (id, patch) => setItems(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const addItem = () => setItems([...items, emptyItem()]);
  const removeItem = (id) => items.length > 1 && setItems(items.filter((it) => it.id !== id));

  const subtotal = items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0), 0);
  const iva = subtotal * (settings.ivaRate / 100);
  const total = subtotal + iva;

  const createInvoice = async () => {
    setError("");
    if (!client.name.trim() || !client.nit.trim()) return setError("Completa nombre y NIT/CC del cliente.");
    if (items.some((it) => !it.desc.trim() || !it.qty || !it.price)) return setError("Completa todos los ítems de la factura.");
    setBusy(true);
    try {
      await onCreateInvoice({
        date, client: { ...client }, paymentType,
        items: items.map((it) => ({ desc: it.desc, qty: parseFloat(it.qty), price: parseFloat(it.price) })),
        subtotal, iva, total,
      });
      setClient({ name: "", nit: "" });
      setItems([emptyItem()]);
    } catch (e) {
      setError(e.message || "No se pudo generar la factura.");
    } finally {
      setBusy(false);
    }
  };

  const postInvoice = async (invoice) => {
    setPostingId(invoice.id);
    try {
      await onPostInvoice(invoice);
    } catch (e) {
      setError(e.message || "No se pudo contabilizar la factura.");
    } finally {
      setPostingId(null);
    }
  };

  const doPrint = (invoice) => {
    setPrinting(invoice);
    setTimeout(() => window.print(), 50);
  };

  return (
    <div className="stack-lg">
      <div className="dian-note">
        <AlertTriangle size={16} />
        <span>Esta factura incluye los datos que exige la DIAN, pero no se transmite electrónicamente: eso requiere un proveedor tecnológico autorizado, resolución de facturación y CUFE.</span>
      </div>

      <Card title="Nueva factura de venta">
                {thirdParties.length > 0 && (
          <div className="form-row">
            <select className="input" onChange={(e) => {
              const tp = thirdParties.find((t) => t.id === e.target.value);
              if (tp) setClient({ name: tp.name, nit: tp.nit });
            }} defaultValue="">
              <option value="">Cliente guardado…</option>
              {thirdParties.filter((t) => t.type !== "proveedor").map((t) => (
                <option key={t.id} value={t.id}>{t.name} · {t.nit}</option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <input className="input" placeholder="Nombre o razón social del cliente" value={client.name}
            onChange={(e) => setClient({ ...client, name: e.target.value })} />
          <input className="input input-sm" placeholder="NIT / Cédula" value={client.nit}
            onChange={(e) => setClient({ ...client, nit: e.target.value })} />
          <input type="date" className="input input-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className="input input-sm" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
            <option value="credito">Crédito</option>
            <option value="contado">Contado</option>
          </select>
        </div>

        <table className="ledger-table entry-table">
          <thead><tr><th>Descripción</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">Subtotal</th><th></th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td><input className="input" placeholder="Producto o servicio" value={it.desc} onChange={(e) => updateItem(it.id, { desc: e.target.value })} /></td>
                <td><input className="input input-sm text-right mono" type="number" min="0" value={it.qty} onChange={(e) => updateItem(it.id, { qty: e.target.value })} /></td>
                <td><input className="input input-sm text-right mono" type="number" min="0" value={it.price} onChange={(e) => updateItem(it.id, { price: e.target.value })} /></td>
                <td className="text-right mono">{fmtCOP((parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0))}</td>
                <td><button className="icon-btn" onClick={() => removeItem(it.id)} disabled={items.length <= 1}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-ghost btn-sm" onClick={addItem}><Plus size={14} /> Ítem</button>

        <div className="invoice-totals">
          <div><span>Subtotal</span><span className="mono">{fmtCOP(subtotal)}</span></div>
          <div><span>IVA ({settings.ivaRate}%)</span><span className="mono">{fmtCOP(iva)}</span></div>
          <div className="invoice-total-final"><span>Total</span><span className="mono">{fmtCOP(total)}</span></div>
        </div>

        {error && <p className="error-text"><AlertTriangle size={14} /> {error}</p>}
        <div className="entry-footer">
          <span />
          <button className="btn btn-primary" onClick={createInvoice} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <><Receipt size={16} /> Generar factura</>}
          </button>
        </div>
      </Card>

      <Card
        title="Facturas"
        right={
          <div className="search-box">
            <Search size={14} />
            <input placeholder="Buscar por cliente o N.º…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        }
      >
        {(() => {
          const filteredInvoices = invoices.filter((inv) =>
            inv.client.name.toLowerCase().includes(query.toLowerCase()) || String(inv.number).includes(query)
          );
          return filteredInvoices.length === 0 ? (
          <EmptyState icon={Receipt} title="Aún no has emitido facturas" />
        ) : (
          <table className="ledger-table">
            <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th className="text-right">Total</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {[...invoices].reverse().map((inv) => (
                <tr key={inv.id}>
                  <td className="mono">{String(inv.number).padStart(4, "0")}</td>
                  <td>{fmtDate(inv.date)}</td>
                  <td>{inv.client.name}</td>
                  <td className="text-right mono">{fmtCOP(inv.total)}</td>
                  <td><span className={`badge ${inv.status === "contabilizada" ? "badge-green" : "badge-gray"}`}>{inv.status}</span></td>
                  <td className="row-actions">
                    {inv.status === "borrador" && (
                      <button className="btn btn-ghost btn-xs" onClick={() => postInvoice(inv)} disabled={postingId === inv.id}>
                        {postingId === inv.id ? <Loader2 size={12} className="spin" /> : "Contabilizar"}
                      </button>
                    )}
                    <button className="icon-btn" title="Imprimir" onClick={() => doPrint(inv)}><Printer size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {printing && (
        <div className="print-overlay">
          <div className="print-overlay-bar no-print">
            <span>Vista de impresión</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPrinting(null)}><X size={14} /> Cerrar</button>
          </div>
          <div className="invoice-sheet" ref={printRef}>
            <div className="invoice-sheet-head">
              <div>
                <div className="invoice-company">{settings.companyName}</div>
                <div className="invoice-meta">NIT {settings.nit} · {settings.city}, Colombia</div>
              </div>
              <div className="invoice-seal">
                <div className="invoice-seal-label">Factura de venta</div>
                <div className="invoice-seal-number">N.º {String(printing.number).padStart(4, "0")}</div>
              </div>
            </div>
            <div className="invoice-parties">
              <div><span className="statement-label">Cliente</span><p>{printing.client.name}</p><p className="mono">NIT/CC {printing.client.nit}</p></div>
              <div><span className="statement-label">Fecha</span><p>{fmtDate(printing.date)}</p><p className="capitalize">{printing.paymentType}</p></div>
            </div>
            <table className="ledger-table">
              <thead><tr><th>Descripción</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">Subtotal</th></tr></thead>
              <tbody>
                {printing.items.map((it, i) => (
                  <tr key={i}><td>{it.desc}</td><td className="text-right mono">{it.qty}</td><td className="text-right mono">{fmtCOP(it.price)}</td><td className="text-right mono">{fmtCOP(it.qty * it.price)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="invoice-totals">
              <div><span>Subtotal</span><span className="mono">{fmtCOP(printing.subtotal)}</span></div>
              <div><span>IVA</span><span className="mono">{fmtCOP(printing.iva)}</span></div>
              <div className="invoice-total-final"><span>Total</span><span className="mono">{fmtCOP(printing.total)}</span></div>
            </div>
            <p className="invoice-footer-note">Documento generado internamente. No constituye factura electrónica autorizada por la DIAN.</p>
          </div>
        </div>
      )}
    </div>
  );
}
/* ───────────────────────── Compras y gastos ───────────────────────── */

function emptyPurchaseItem() { return { id: uid(), desc: "", qty: 1, price: "" }; }

function Purchases({ accounts, thirdParties, purchases, settings, onCreatePurchase, onPostPurchase }) {
  const [provider, setProvider] = useState({ name: "", nit: "" });
  const [date, setDate] = useState(todayISO());
  const [paymentType, setPaymentType] = useState("credito");
  const [expenseAccount, setExpenseAccount] = useState("");
  const [items, setItems] = useState([emptyPurchaseItem()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [postingId, setPostingId] = useState(null);

  const expenseAccounts = accounts.filter((a) => a.class === "5" || a.class === "6");

  const updateItem = (id, patch) => setItems(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const addItem = () => setItems([...items, emptyPurchaseItem()]);
  const removeItem = (id) => items.length > 1 && setItems(items.filter((it) => it.id !== id));

  const subtotal = items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0), 0);
  const iva = subtotal * (settings.ivaRate / 100);
  const total = subtotal + iva;

  const create = async () => {
    setError("");
    if (!provider.name.trim() || !provider.nit.trim()) return setError("Completa nombre y NIT/CC del proveedor.");
    if (!expenseAccount) return setError("Selecciona la cuenta de gasto o costo.");
    if (items.some((it) => !it.desc.trim() || !it.qty || !it.price)) return setError("Completa todos los ítems.");
    setBusy(true);
    try {
      await onCreatePurchase({
        date, provider: { ...provider }, paymentType, expenseAccount,
        items: items.map((it) => ({ desc: it.desc, qty: parseFloat(it.qty), price: parseFloat(it.price) })),
        subtotal, iva, total,
      });
      setProvider({ name: "", nit: "" });
      setExpenseAccount("");
      setItems([emptyPurchaseItem()]);
    } catch (e) {
      setError(e.message || "No se pudo registrar la compra/gasto.");
    } finally {
      setBusy(false);
    }
  };

  const post = async (p) => {
    setPostingId(p.id);
    try {
      await onPostPurchase(p);
    } catch (e) {
      setError(e.message || "No se pudo contabilizar.");
    } finally {
      setPostingId(null);
    }
  };

  return (
    <div className="stack-lg">
      <Card title="Nueva compra / gasto">
        {thirdParties.length > 0 && (
          <div className="form-row">
            <select className="input" onChange={(e) => {
              const tp = thirdParties.find((t) => t.id === e.target.value);
              if (tp) setProvider({ name: tp.name, nit: tp.nit });
            }} defaultValue="">
              <option value="">Proveedor guardado…</option>
              {thirdParties.filter((t) => t.type !== "cliente").map((t) => (
                <option key={t.id} value={t.id}>{t.name} · {t.nit}</option>
              ))}
            </select>
          </div>
        )}
        <div className="form-row">
          <input className="input" placeholder="Nombre o razón social del proveedor" value={provider.name}
            onChange={(e) => setProvider({ ...provider, name: e.target.value })} />
          <input className="input input-sm" placeholder="NIT / Cédula" value={provider.nit}
            onChange={(e) => setProvider({ ...provider, nit: e.target.value })} />
          <input type="date" className="input input-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          <select className="input input-sm" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
            <option value="credito">Crédito</option>
            <option value="contado">Contado</option>
          </select>
        </div>
        <div className="form-row">
          <select className="input" value={expenseAccount} onChange={(e) => setExpenseAccount(e.target.value)}>
            <option value="">Cuenta de gasto o costo…</option>
            {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
          </select>
        </div>

        <table className="ledger-table entry-table">
          <thead><tr><th>Descripción</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">Subtotal</th><th></th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td><input className="input" placeholder="Producto o servicio" value={it.desc} onChange={(e) => updateItem(it.id, { desc: e.target.value })} /></td>
                <td><input className="input input-sm text-right mono" type="number" min="0" value={it.qty} onChange={(e) => updateItem(it.id, { qty: e.target.value })} /></td>
                <td><input className="input input-sm text-right mono" type="number" min="0" value={it.price} onChange={(e) => updateItem(it.id, { price: e.target.value })} /></td>
                <td className="text-right mono">{fmtCOP((parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0))}</td>
                <td><button className="icon-btn" onClick={() => removeItem(it.id)} disabled={items.length <= 1}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-ghost btn-sm" onClick={addItem}><Plus size={14} /> Ítem</button>

        <div className="invoice-totals">
          <div><span>Subtotal</span><span className="mono">{fmtCOP(subtotal)}</span></div>
          <div><span>IVA ({settings.ivaRate}%)</span><span className="mono">{fmtCOP(iva)}</span></div>
          <div className="invoice-total-final"><span>Total</span><span className="mono">{fmtCOP(total)}</span></div>
        </div>

        {error && <p className="error-text"><AlertTriangle size={14} /> {error}</p>}
        <div className="entry-footer">
          <span />
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <><ShoppingBag size={16} /> Registrar</>}
          </button>
        </div>
      </Card>

      <Card title="Compras y gastos">
        {purchases.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="Aún no has registrado compras o gastos" />
        ) : (
          <table className="ledger-table">
            <thead><tr><th>N.º</th><th>Fecha</th><th>Proveedor</th><th className="text-right">Total</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {[...purchases].reverse().map((p) => (
                <tr key={p.id}>
                  <td className="mono">{String(p.number).padStart(4, "0")}</td>
                  <td>{fmtDate(p.date)}</td>
                  <td>{p.provider.name}</td>
                  <td className="text-right mono">{fmtCOP(p.total)}</td>
                  <td><span className={`badge ${p.status === "contabilizada" ? "badge-green" : "badge-gray"}`}>{p.status}</span></td>
                  <td className="row-actions">
                    {p.status === "borrador" && (
                      <button className="btn btn-ghost btn-xs" onClick={() => post(p)} disabled={postingId === p.id}>
                        {postingId === p.id ? <Loader2 size={12} className="spin" /> : "Contabilizar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
/* ───────────────────────── Formularios DIAN ───────────────────────── */

function TaxForms({ entries, invoices, purchases }) {
  const today = todayISO();
  const firstOfMonth = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);

  const inRange = (dateStr) => dateStr >= from && dateStr <= to;

  const invoicesInRange = invoices.filter((i) => i.status === "contabilizada" && inRange(i.date));
  const purchasesInRange = purchases.filter((p) => p.status === "contabilizada" && inRange(p.date));

  const ivaGenerado = invoicesInRange.reduce((s, i) => s + i.iva, 0);
  const ivaDescontable = purchasesInRange.reduce((s, p) => s + p.iva, 0);
  const ivaAPagar = ivaGenerado - ivaDescontable;

  const retencionPracticada = invoicesInRange.reduce((s, i) => s + (i.retencionValue || 0), 0);

  const ventasBrutas = invoicesInRange.reduce((s, i) => s + i.subtotal, 0);
  const comprasBrutas = purchasesInRange.reduce((s, p) => s + p.subtotal, 0);

  const exportExcel = () => {
    const form300 = [
      { Concepto: "Ventas gravadas (base)", Valor: ventasBrutas },
      { Concepto: "IVA generado en ventas", Valor: ivaGenerado },
      { Concepto: "Compras gravadas (base)", Valor: comprasBrutas },
      { Concepto: "IVA descontable en compras", Valor: ivaDescontable },
      { Concepto: "IVA a pagar (o saldo a favor si es negativo)", Valor: ivaAPagar },
    ];
    const form350 = [
      { Concepto: "Total facturado en el periodo", Valor: ventasBrutas },
      { Concepto: "Retención en la fuente practicada por clientes", Valor: retencionPracticada },
    ];
    const detalle = invoicesInRange.map((i) => ({
      Factura: String(i.number).padStart(4, "0"), Fecha: fmtDate(i.date), Cliente: i.client.name,
      Subtotal: i.subtotal, IVA: i.iva, Retención: i.retencionValue || 0, Total: i.total,
    }));
    exportToExcel(`dian-${from}_a_${to}`, [
      { name: "Formulario 300 (IVA)", rows: form300 },
      { name: "Formulario 350 (Retención)", rows: form350 },
      { name: "Detalle facturas", rows: detalle },
    ]);
  };

  return (
    <div className="stack-lg">
      <div className="dian-note">
        <AlertTriangle size={16} />
        <span>Estos valores se calculan a partir de tus comprobantes contabilizados. Revísalos con tu contador antes de presentarlos — esto no transmite nada directamente a la DIAN.</span>
      </div>

      <Card title="Periodo a calcular">
        <div className="form-row">
          <label className="hint-text">Desde <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="hint-text">Hasta <input type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn btn-ghost btn-sm" onClick={exportExcel}><Download size={14} /> Exportar Excel</button>
        </div>
      </Card>

      <div className="two-col">
        <Card title="Formulario 300 · IVA">
          <div className="statement-row"><span>Ventas gravadas (base)</span><Money value={ventasBrutas} /></div>
          <div className="statement-row"><span>IVA generado en ventas</span><Money value={ivaGenerado} /></div>
          <div className="statement-row" style={{ marginTop: 10 }}><span>Compras gravadas (base)</span><Money value={comprasBrutas} /></div>
          <div className="statement-row"><span>IVA descontable en compras</span><Money value={ivaDescontable} /></div>
          <div className={`statement-row statement-total ${ivaAPagar >= 0 ? "text-ink-red" : "text-ink-green"}`}>
            <span>{ivaAPagar >= 0 ? "IVA a pagar" : "Saldo a favor"}</span>
            <Money value={Math.abs(ivaAPagar)} />
          </div>
        </Card>

        <Card title="Formulario 350 · Retención en la fuente">
          <div className="statement-row"><span>Total facturado en el periodo</span><Money value={ventasBrutas} /></div>
          <div className="statement-row statement-total"><span>Retención que te practicaron</span><Money value={retencionPracticada} /></div>
          <p className="empty-hint" style={{ marginTop: 14 }}>
            Este valor es la retención que tus clientes te descontaron al pagarte — se declara como anticipo de tus propios impuestos, no como algo que tú debes pagar aparte.
          </p>
        </Card>
      </div>
    </div>
  );
}
/* ───────────────────────── Ajustes ───────────────────────── */

function SettingsPanel({ settings, onUpdate, voucherTypes, onAddVoucherType, onRemoveVoucherType }) {
  const [local, setLocal] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setLocal(settings), [settings]);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      await onUpdate({
        name: local.companyName,
        nit: local.nit,
        city: local.city,
        iva_rate: local.ivaRate,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  const [typeForm, setTypeForm] = useState({ name: "", prefix: "" });
  const [typeError, setTypeError] = useState("");
  const [typeBusy, setTypeBusy] = useState(false);

  const addType = async () => {
    setTypeError("");
    if (!typeForm.name.trim()) return setTypeError("Escribe un nombre para el tipo de comprobante.");
    if (!/^[A-Za-z0-9]{1,6}$/.test(typeForm.prefix)) return setTypeError("El prefijo debe tener entre 1 y 6 letras o números (ej. CI, GTO).");
    if (voucherTypes.some((t) => t.prefix.toLowerCase() === typeForm.prefix.toLowerCase())) return setTypeError("Ya existe un tipo con ese prefijo.");
    setTypeBusy(true);
    try {
      await onAddVoucherType({ name: typeForm.name.trim(), prefix: typeForm.prefix.toUpperCase() });
      setTypeForm({ name: "", prefix: "" });
    } catch (e) {
      setTypeError(e.message || "No se pudo crear el tipo de comprobante.");
    } finally {
      setTypeBusy(false);
    }
  };

  const removeType = async (id) => {
    setTypeError("");
    try {
      await onRemoveVoucherType(id);
    } catch (e) {
      setTypeError(e.message || "No se pudo eliminar (puede tener comprobantes asociados).");
    }
  };

  return (
    <div className="stack-lg">
      <Card title="Datos de la empresa">
        <div className="form-row-stack">
          <label>Razón social<input className="input" value={local.companyName} onChange={(e) => setLocal({ ...local, companyName: e.target.value })} /></label>
          <label>NIT<input className="input" value={local.nit} onChange={(e) => setLocal({ ...local, nit: e.target.value })} /></label>
          <label>Ciudad<input className="input" value={local.city} onChange={(e) => setLocal({ ...local, city: e.target.value })} /></label>
          <label>Tarifa de IVA (%)<input className="input" type="number" value={local.ivaRate} onChange={(e) => setLocal({ ...local, ivaRate: parseFloat(e.target.value) || 0 })} /></label>
          <button className="btn btn-primary" onClick={save} disabled={busy} style={{ alignSelf: "flex-start" }}>
            {busy ? <Loader2 size={16} className="spin" /> : saved ? <><Check size={16} /> Guardado</> : "Guardar cambios"}
          </button>
        </div>
      </Card>

      <Card title="Tipos de comprobante contable" right={<span className="hint-text">Tú decides cuáles usar</span>}>
        <div className="form-row">
          <input className="input" placeholder="Nombre (ej. Comprobante de nómina)" value={typeForm.name}
            onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} />
          <input className="input input-sm" placeholder="Prefijo (ej. CN)" value={typeForm.prefix} maxLength={6}
            onChange={(e) => setTypeForm({ ...typeForm, prefix: e.target.value.toUpperCase() })} />
          <button className="btn btn-primary" onClick={addType} disabled={typeBusy}>
            {typeBusy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Agregar
          </button>
        </div>
        {typeError && <p className="error-text"><AlertTriangle size={14} /> {typeError}</p>}
        <table className="ledger-table">
          <thead><tr><th>Prefijo</th><th>Nombre</th><th></th></tr></thead>
          <tbody>
            {voucherTypes.map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.prefix}</td>
                <td>{t.name}</td>
                <td className="text-right">
                  <button className="icon-btn" title="Eliminar" onClick={() => removeType(t.id)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {voucherTypes.length === 0 && (
              <tr><td colSpan={3}><EmptyState icon={ScrollText} title="Aún no tienes tipos de comprobante" /></td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ───────────────────────── Pantallas de carga / error ───────────────────────── */

function BootScreen({ text }) {
  return (
    <div className="boot-screen">
      <style>{CSS}</style>
      <Loader2 className="spin" size={22} /> {text}
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div className="boot-screen">
      <style>{CSS}</style>
      <div style={{ textAlign: "center" }}>
        <AlertTriangle size={22} style={{ marginBottom: 8 }} />
        <p style={{ fontFamily: "'Inter',sans-serif", fontSize: 13 }}>{message}</p>
        {onRetry && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onRetry}>Reintentar</button>}
      </div>
    </div>
  );
}

/* ───────────────────────── App raíz ───────────────────────── */

const TABS = [
  { id: "dashboard", label: "Resumen", icon: LayoutDashboard, group: "Inicio" },
  { id: "invoicing", label: "Facturación", icon: Receipt, group: "Ventas" },
  { id: "thirdparties", label: "Terceros", icon: Users, group: "Ventas" },
  { id: "purchases", label: "Compras y gastos", icon: ShoppingBag, group: "Compras" },
  { id: "accounts", label: "Plan de cuentas", icon: Landmark, group: "Contabilidad" },
  { id: "entries", label: "Comprobantes", icon: ScrollText, group: "Contabilidad" },
  { id: "ledger", label: "Libro mayor", icon: BookOpen, group: "Contabilidad" },
  { id: "trial", label: "Balance de prueba", icon: Scale, group: "Contabilidad" },
  { id: "statements", label: "Estados financieros", icon: FileText, group: "Contabilidad" },
  { id: "taxes", label: "Formularios DIAN", icon: Calculator, group: "Impuestos" },
  { id: "settings", label: "Ajustes", icon: Settings2, group: "Configuración" },
];

const GROUPS = ["Inicio", "Ventas", "Compras", "Contabilidad", "Impuestos", "Configuración"];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = todavía no se sabe
  const [company, setCompany] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [entries, setEntries] = useState([]);
  const [invoices, setInvoices] = useState([]);   const [voucherTypes, setVoucherTypes] = useState([]); const [thirdParties, setThirdParties] = useState([]);  const [purchases, setPurchases] = useState([]); const [createOpen, setCreateOpen] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [tab, setTab] = useState("dashboard");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reloadAll = async (companyId) => {
    const [acc, ent, inv, vt, tp, pu] = await Promise.all([
      fetchAccounts(companyId), fetchEntries(companyId), fetchInvoices(companyId), fetchVoucherTypes(companyId), fetchThirdParties(companyId), fetchPurchases(companyId),
    ]);
    setAccounts(acc); setEntries(ent); setInvoices(inv); setVoucherTypes(vt); setThirdParties(tp); setPurchases(pu);
  };
  
  const loadEverything = async () => {
    setDataLoading(true);
    setDataError("");
    try {
      const c = await getOrCreateCompany(session.user.id);
      setCompany(c);
      await reloadAll(c.id);
    } catch (e) {
      setDataError(e.message || "No se pudo cargar la información de tu empresa.");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (session) loadEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (session === undefined) return <BootScreen text="Cargando…" />;
  if (session === null) return <Auth />;
  if (dataLoading) return <BootScreen text="Abriendo los libros…" />;
  if (dataError) return <ErrorScreen message={dataError} onRetry={loadEverything} />;

  const settings = {
    companyName: company.name || "Mi Empresa S.A.S.",
    nit: company.nit || "",
    city: company.city || "",
    ivaRate: company.iva_rate ?? 19,
  };

  const handleAddAccount = async (account) => {
    await insertAccount(company.id, account);
    await reloadAll(company.id);
  };

  const handleRemoveAccount = async (code) => {
    await deleteAccount(company.id, code);
    await reloadAll(company.id);
  };
    const handleAddVoucherType = async (type) => {
    await insertVoucherType(company.id, type);
    await reloadAll(company.id);
  };

    const handleRemoveVoucherType = async (id) => {
    await deleteVoucherType(company.id, id);
    await reloadAll(company.id);
  };
  
  const handleAddThirdParty = async (tp) => {
    await insertThirdParty(company.id, tp);
    await reloadAll(company.id);
  };

  const handleRemoveThirdParty = async (id) => {
    await deleteThirdParty(company.id, id);
    await reloadAll(company.id);
  };

  
  const handleCreatePurchase = async (draft) => {
    const number = purchases.length ? Math.max(...purchases.map((p) => p.number)) + 1 : 1;
    await insertPurchase(company.id, { ...draft, number });
    await reloadAll(company.id);
  };

  const handlePostPurchase = async (purchase) => {
    const egresoType = voucherTypes.find((t) => t.prefix === "CE") || voucherTypes[0];
    const sameType = entries.filter((e) => e.voucherTypeId === egresoType?.id);
    const number = sameType.length ? Math.max(...sameType.map((e) => e.number)) + 1 : 1;
    const creditAccount = purchase.paymentType === "contado" ? "1105" : "2205";
    const lines = [
      { accountCode: purchase.expenseAccount, debit: purchase.subtotal, credit: 0 },
      ...(purchase.iva > 0 ? [{ accountCode: "1355", debit: purchase.iva, credit: 0 }] : []),
      { accountCode: creditAccount, debit: 0, credit: purchase.total },
    ];
    const entryId = await insertEntry(company.id, {
      number, voucherTypeId: egresoType?.id, date: purchase.date,
      description: `Compra/gasto N.º ${purchase.number} — ${purchase.provider.name}`,
      lines,
    });
    await markPurchasePosted(purchase.id, entryId);
    await reloadAll(company.id);
  };

  const handleAddEntry = async (draft) => {
        const sameType = entries.filter((e) => e.voucherTypeId === draft.voucherTypeId);
    const number = sameType.length ? Math.max(...sameType.map((e) => e.number)) + 1 : 1;
    await insertEntry(company.id, { ...draft, number });
    await reloadAll(company.id);
  };

  const handleCreateInvoice = async (draft) => {
    const number = invoices.length ? Math.max(...invoices.map((i) => i.number)) + 1 : 1;
    await insertInvoice(company.id, { ...draft, number });
    await reloadAll(company.id);
  };

  const handlePostInvoice = async (invoice) => {
    const ingresoType = voucherTypes.find((t) => t.prefix === "CI") || voucherTypes[0];
    const sameType = entries.filter((e) => e.voucherTypeId === ingresoType?.id);
    const number = sameType.length ? Math.max(...sameType.map((e) => e.number)) + 1 : 1;
    const debitAccount = invoice.paymentType === "contado" ? "1105" : "1305";
    const lines = [
      { accountCode: debitAccount, debit: invoice.total, credit: 0 },
      { accountCode: "4175", debit: 0, credit: invoice.subtotal },
      ...(invoice.iva > 0 ? [{ accountCode: "2408", debit: 0, credit: invoice.iva }] : []),
    ];
    const entryId = await insertEntry(company.id, {
      number, voucherTypeId: ingresoType?.id, date: invoice.date,
      description: `Factura de venta N.º ${invoice.number} — ${invoice.client.name}`,
      lines,
    });
    await markInvoicePosted(invoice.id, entryId);
    await reloadAll(company.id);
  };

  const handleUpdateSettings = async (patch) => {
    await updateCompany(company.id, patch);
    setCompany({ ...company, ...patch });
  };

  const ActiveIcon = TABS.find((t) => t.id === tab)?.icon || LayoutDashboard;

  return (
    <div className="app-shell">
      <style>{CSS}</style>

      <aside className="sidebar">
        <div className="brand">
          <svg width={24} height={24} viewBox="0 0 140 140"><rect width="140" height="140" rx="28" fill="#123C39"/><rect x="35" y="78" width="72" height="24" rx="12" fill="#FFFFFF"/><circle cx="50" cy="72" r="18" fill="#FFFFFF"/><circle cx="73" cy="60" r="23" fill="#FFFFFF"/><circle cx="97" cy="73" r="17" fill="#FFFFFF"/><path d="M53 76 L66 88 L91 60" fill="none" stroke="#0F8F73" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <div>
            <div className="brand-title">ContaSoft Nube</div>
            <div className="brand-sub">{settings.companyName}</div>
          </div>
        </div>
        <nav className="tabs">
          {GROUPS.map((g) => (
            <div className="tab-group" key={g}>
              <div className="tab-group-label">{g}</div>
              {TABS.filter((t) => t.group === g).map((t) => (
                <button key={t.id} className={`tab-btn ${tab === t.id ? "tab-active" : ""}`} onClick={() => setTab(t.id)}>
                  <t.icon size={16} />
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="tab-btn logout-btn" onClick={() => supabase.auth.signOut()}>
          <LogOut size={16} /> Cerrar sesión
        </button>
      </aside>

      <main className="main">
        <header className="topbar no-print">
          <div className="topbar-title"><ActiveIcon size={18} /> {TABS.find((t) => t.id === tab)?.label}</div>
          <div className="topbar-right">
            <div className="create-wrap">
              {createOpen && <div className="create-backdrop" onClick={() => setCreateOpen(false)} />}
              <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen((o) => !o)}>
                <Plus size={14} /> Crear
              </button>
              {createOpen && (
                <div className="create-menu">
                  <div className="create-menu-label">Ventas</div>
                  <button className="create-menu-item" onClick={() => { setTab("invoicing"); setCreateOpen(false); }}>
                    <Receipt size={14} /> Factura de venta
                  </button>
                  <div className="create-menu-label">Compras</div>
                  <button className="create-menu-item" onClick={() => { setTab("purchases"); setCreateOpen(false); }}>
                    <ShoppingBag size={14} /> Compra / gasto
                  </button>
                  <div className="create-menu-label">Contabilidad</div>
                  <button className="create-menu-item" onClick={() => { setTab("entries"); setCreateOpen(false); }}>
                    <ScrollText size={14} /> Comprobante contable
                  </button>
                </div>
              )}
            </div>
            <div className="topbar-date">{fmtDate(todayISO())}</div>
          </div>
        </header>
        <div className="content no-print">
          {tab === "dashboard" && <Dashboard accounts={accounts} entries={entries} invoices={invoices} />}
          {tab === "accounts" && (
            <ChartOfAccounts accounts={accounts} entries={entries} onAdd={handleAddAccount} onRemove={handleRemoveAccount} />
          )}
          {tab === "entries" && <JournalEntries accounts={accounts} entries={entries} voucherTypes={voucherTypes} onSubmit={handleAddEntry} />}
          {tab === "ledger" && <Ledger accounts={accounts} entries={entries} />}
          {tab === "trial" && <TrialBalance accounts={accounts} entries={entries} />}
          {tab === "statements" && <FinancialStatements accounts={accounts} entries={entries} />}
                    {tab === "thirdparties" && (
            <ThirdParties thirdParties={thirdParties} onAdd={handleAddThirdParty} onRemove={handleRemoveThirdParty} />
          )}
                    {tab === "purchases" && (
            <Purchases accounts={accounts} thirdParties={thirdParties} purchases={purchases} settings={settings} onCreatePurchase={handleCreatePurchase} onPostPurchase={handlePostPurchase} />
          )}
          {tab === "invoicing" && (
            <Invoicing entries={entries} invoices={invoices} settings={settings} thirdParties={thirdParties} onCreateInvoice={handleCreateInvoice} onPostInvoice={handlePostInvoice} />
          )}
          {tab === "taxes" && (
            <TaxForms accounts={accounts} entries={entries} invoices={invoices} purchases={purchases} />
          )}
          {tab === "settings" && (
              <SettingsPanel
                settings={settings}
              onUpdate={handleUpdateSettings}
              voucherTypes={voucherTypes}
              onAddVoucherType={handleAddVoucherType}
              onRemoveVoucherType={handleRemoveVoucherType}
            />
          )}
        </div>
      </main>
    </div>
  );
}

/* ───────────────────────── Estilos ───────────────────────── */

const CSS = `
:root{
  --paper:#F6F3EA; --paper-raised:#FFFFFF; --ink:#1B2E35; --ink-soft:#5B6A6E;
  --rule:#D8D0B8; --green:#2F6F4E; --green-soft:#E4EEE7; --red:#B23A2F; --red-soft:#F5E6E3;
  --gold:#A67C3D; --gold-soft:#F1E6D2; --shadow: 0 1px 2px rgba(27,46,53,.06), 0 6px 20px rgba(27,46,53,.05);
}
*{box-sizing:border-box;}
.app-shell{ display:flex; min-height:100vh; background:var(--paper); color:var(--ink); font-family:'Source Serif 4', Georgia, serif; }
.mono{ font-family:'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.capitalize{ text-transform:capitalize; }
.text-right{ text-align:right; }
.text-ink-red{ color:var(--red); }
.text-ink-green{ color:var(--green); }

/* Sidebar */
.sidebar{ width:230px; flex-shrink:0; background:#EDE7D6; border-right:1px solid var(--rule); display:flex; flex-direction:column; padding:18px 12px; position:sticky; top:0; height:100vh; }
.brand{ display:flex; gap:10px; align-items:flex-start; padding:6px 8px 18px; border-bottom:1px solid var(--rule); margin-bottom:14px; }
.brand-title{ font-weight:700; font-size:15px; letter-spacing:.02em; }
.brand-sub{ font-family:'Inter',sans-serif; font-size:11px; color:var(--ink-soft); margin-top:2px; }
.tabs{ display:flex; flex-direction:column; gap:2px; flex:1; }
.tab-btn{ display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:6px; border:none; background:transparent; color:var(--ink); font-family:'Inter',sans-serif; font-size:13.5px; text-align:left; cursor:pointer; }
.tab-btn:hover{ background:#E2DAC2; }
.tab-active{ background:var(--ink); color:var(--paper); }
.logout-btn{ color:var(--red); margin-top:8px; }
.spin{ animation:spin 1s linear infinite; }
@keyframes spin{ to{ transform:rotate(360deg); } }

/* Main */
.main{ flex:1; min-width:0; }
.topbar{ display:flex; justify-content:space-between; align-items:center; padding:16px 28px; border-bottom:1px solid var(--rule); background:var(--paper-raised); }
.topbar-title{ display:flex; align-items:center; gap:8px; font-weight:700; font-size:16px; }
.topbar-date{ font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--ink-soft); }
.content{ padding:24px 28px 60px; max-width:1180px; }
.stack-lg{ display:flex; flex-direction:column; gap:18px; }
.two-col{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }
@media (max-width: 860px){ .app-shell{ flex-direction:column; } .sidebar{ width:100%; height:auto; position:relative; flex-direction:row; flex-wrap:wrap; } .brand{ display:none; } .tabs{ flex-direction:row; flex-wrap:wrap; } .two-col{ grid-template-columns:1fr; } }

/* Card */
.card{ background:var(--paper-raised); border:1px solid var(--rule); border-radius:10px; padding:18px 20px; box-shadow:var(--shadow); }
.card-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
.card-title{ font-weight:700; font-size:14px; letter-spacing:.01em; }
.hint-text{ font-family:'Inter',sans-serif; font-size:11.5px; color:var(--ink-soft); }

/* KPIs */
.kpi-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
.kpi-value{ font-size:22px; font-weight:700; display:block; margin-top:4px; }
@media (max-width: 860px){ .kpi-grid{ grid-template-columns:1fr 1fr; } }

/* Bars */
.bars{ display:flex; align-items:flex-end; gap:14px; height:140px; padding-top:10px; }
.bar-col{ display:flex; flex-direction:column; align-items:center; gap:6px; flex:1; height:100%; justify-content:flex-end; }
.bar-pair{ display:flex; gap:4px; align-items:flex-end; height:110px; }
.bar{ width:10px; border-radius:2px 2px 0 0; min-height:2px; transition:height .3s ease; }
.bar-green{ background:var(--green); }
.bar-red{ background:var(--red); }
.bar-label{ font-family:'IBM Plex Mono',monospace; font-size:10px; color:var(--ink-soft); }
.legend{ display:flex; gap:16px; font-family:'Inter',sans-serif; font-size:11.5px; color:var(--ink-soft); margin-top:10px; }
.dot{ width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:5px; }
.dot-green{ background:var(--green); } .dot-red{ background:var(--red); }

/* Stamps */
.stamp-big{ display:flex; gap:14px; align-items:center; padding:14px; border-radius:8px; border:2px dashed; }
.stamp-ok{ border-color:var(--green); color:var(--green); background:var(--green-soft); }
.stamp-bad{ border-color:var(--red); color:var(--red); background:var(--red-soft); }
.stamp-title{ font-weight:700; font-size:13px; letter-spacing:.04em; }
.stamp-sub{ font-family:'Inter',sans-serif; font-size:11px; margin-top:2px; opacity:.85; }
.stamp-inline{ display:inline-flex; align-items:center; gap:5px; padding:3px 9px; border-radius:20px; font-family:'Inter',sans-serif; font-size:11.5px; font-weight:600; }
.stamp-inline.stamp-ok{ background:var(--green-soft); color:var(--green); }
.stamp-inline.stamp-bad{ background:var(--red-soft); color:var(--red); }
.mini-stats{ display:flex; flex-direction:column; gap:8px; margin-top:14px; font-family:'Inter',sans-serif; font-size:12.5px; }
.mini-stats div{ display:flex; justify-content:space-between; border-bottom:1px dotted var(--rule); padding-bottom:6px; }

/* Forms */
.form-row{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
.form-row-stack{ display:flex; flex-direction:column; gap:12px; max-width:360px; font-family:'Inter',sans-serif; font-size:13px; }
.form-row-stack label{ display:flex; flex-direction:column; gap:5px; color:var(--ink-soft); }
.input{ font-family:'Inter',sans-serif; font-size:13px; padding:8px 10px; border:1px solid var(--rule); border-radius:6px; background:#FCFBF6; color:var(--ink); flex:1; min-width:120px; }
.input:focus{ outline:2px solid var(--gold); outline-offset:1px; }
.input-sm{ flex:none; width:130px; }
.nature-pill{ font-family:'Inter',sans-serif; font-size:11px; color:var(--ink-soft); background:var(--gold-soft); padding:6px 10px; border-radius:20px; white-space:nowrap; }
.error-text{ color:var(--red); font-family:'Inter',sans-serif; font-size:12.5px; display:flex; gap:6px; align-items:center; margin-top:8px; }
.search-box{ display:flex; align-items:center; gap:6px; background:#FCFBF6; border:1px solid var(--rule); border-radius:20px; padding:5px 10px; }
.search-box input{ border:none; background:transparent; font-family:'Inter',sans-serif; font-size:12.5px; outline:none; }

/* Buttons */
.btn{ font-family:'Inter',sans-serif; font-size:13px; font-weight:600; border-radius:6px; padding:8px 14px; border:1px solid transparent; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
.btn-primary{ background:var(--ink); color:var(--paper); }
.btn-primary:hover{ background:#0f1c21; }
.btn-primary:disabled{ opacity:.7; cursor:default; }
.btn-ghost{ background:transparent; border-color:var(--rule); color:var(--ink); }
.btn-ghost:hover{ background:#EFE9D8; }
.btn-sm{ font-size:12px; padding:6px 10px; }
.btn-xs{ font-size:11.5px; padding:4px 8px; }
.icon-btn{ background:transparent; border:none; color:var(--ink-soft); cursor:pointer; padding:4px; border-radius:5px; }
.icon-btn:hover{ background:#EFE9D8; color:var(--ink); }
.icon-btn:disabled{ opacity:.3; cursor:not-allowed; }

/* Tables */
.ledger-table{ width:100%; border-collapse:collapse; font-family:'Inter',sans-serif; font-size:13px; }
.ledger-table th{ text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-soft); border-bottom:1px solid var(--ink); padding:6px 8px; }
.ledger-table td{ padding:7px 8px; border-bottom:1px solid var(--rule); }
.ledger-table tfoot td{ border-top:2px solid var(--ink); border-bottom:none; font-weight:700; padding-top:9px; }
.ledger-table.nested{ margin-top:6px; background:#FBF9F1; border-radius:6px; }
.entry-table select, .entry-table input{ width:100%; }
.totals-row td{ font-weight:700; }

/* Journal entries list */
.entries-list{ display:flex; flex-direction:column; gap:6px; }
.entry-item{ border:1px solid var(--rule); border-radius:8px; overflow:hidden; }
.entry-item-head{ display:grid; grid-template-columns:74px 80px 1fr 120px 20px; gap:10px; align-items:center; width:100%; background:transparent; border:none; padding:10px 12px; font-family:'Inter',sans-serif; font-size:12.5px; cursor:pointer; text-align:left; }
.entry-item-head:hover{ background:#FBF9F1; }
.entry-no{ color:var(--gold); font-weight:700; }
.entry-date{ color:var(--ink-soft); }
.entry-total{ text-align:right; }
.chev{ transition:transform .15s ease; color:var(--ink-soft); }
.chev-open{ transform:rotate(90deg); }
.entry-footer{ display:flex; justify-content:space-between; align-items:center; margin-top:10px; }

/* Statements */
.statement-label{ font-family:'Inter',sans-serif; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--gold); margin-bottom:6px; }
.statement-row{ display:flex; justify-content:space-between; font-size:13.5px; padding:5px 0; border-bottom:1px dotted var(--rule); }
.statement-row.muted{ color:var(--ink-soft); font-style:italic; }
.statement-total{ font-weight:700; border-bottom:2px solid var(--ink); border-top:1px solid var(--ink); margin-top:2px; }
.statement-check{ margin-top:16px; padding-top:10px; border-top:1px solid var(--rule); border-bottom:none; align-items:center; }

/* Invoicing */
.dian-note{ display:flex; gap:10px; align-items:flex-start; background:var(--gold-soft); border:1px solid var(--gold); color:#6b4f22; padding:10px 14px; border-radius:8px; font-family:'Inter',sans-serif; font-size:12.5px; }
.invoice-totals{ display:flex; flex-direction:column; align-items:flex-end; gap:4px; margin-top:12px; font-family:'Inter',sans-serif; font-size:13px; }
.invoice-totals div{ display:flex; justify-content:space-between; gap:30px; width:220px; }
.invoice-total-final{ font-weight:700; font-size:15px; border-top:1px solid var(--ink); padding-top:6px; }
.badge{ font-family:'Inter',sans-serif; font-size:11px; padding:3px 9px; border-radius:20px; font-weight:600; }
.badge-green{ background:var(--green-soft); color:var(--green); }
.badge-gray{ background:#EDE7D6; color:var(--ink-soft); }
.tab-group{ margin-bottom:10px; }
.tab-group-label{ font-family:'Inter',sans-serif; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--ink-soft); padding:6px 10px 4px; }
.topbar-right{ display:flex; align-items:center; gap:14px; }
.create-wrap{ position:relative; }
.create-backdrop{ position:fixed; inset:0; z-index:40; }
.create-menu{ position:absolute; top:calc(100% + 6px); right:0; background:var(--paper-raised); border:1px solid var(--rule); border-radius:8px; box-shadow:var(--shadow); padding:6px; min-width:200px; z-index:41; }
.create-menu-label{ font-family:'Inter',sans-serif; font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--ink-soft); padding:6px 8px 2px; }
.create-menu-item{ display:flex; align-items:center; gap:8px; width:100%; padding:8px; border:none; background:transparent; border-radius:6px; font-family:'Inter',sans-serif; font-size:13px; cursor:pointer; text-align:left; color:var(--ink); }
.create-menu-item:hover{ background:#EFE9D8; }
.row-actions{ display:flex; gap:6px; justify-content:flex-end; }

/* Print sheet */
.print-overlay{ position:fixed; inset:0; background:rgba(27,46,53,.5); z-index:50; overflow:auto; padding:30px; }
.print-overlay-bar{ display:flex; justify-content:space-between; align-items:center; color:#fff; max-width:640px; margin:0 auto 12px; font-family:'Inter',sans-serif; font-size:13px; }
.invoice-sheet{ background:#fff; max-width:640px; margin:0 auto; padding:36px; border-radius:4px; font-family:'Inter',sans-serif; }
.invoice-sheet-head{ display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid var(--ink); padding-bottom:14px; margin-bottom:14px; }
.invoice-company{ font-family:'Source Serif 4',serif; font-weight:700; font-size:17px; }
.invoice-meta{ font-size:12px; color:var(--ink-soft); margin-top:3px; }
.invoice-seal{ text-align:right; border:2px solid var(--gold); border-radius:6px; padding:8px 14px; color:var(--gold); }
.invoice-seal-label{ font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
.invoice-seal-number{ font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:15px; }
.invoice-parties{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; font-size:13px; }
.invoice-parties p{ margin:2px 0; }
.invoice-footer-note{ font-size:10.5px; color:var(--ink-soft); margin-top:20px; border-top:1px dotted var(--rule); padding-top:10px; }
@media print{ body *{ visibility:hidden; } .invoice-sheet, .invoice-sheet *{ visibility:visible; } .invoice-sheet{ position:absolute; top:0; left:0; box-shadow:none; } .no-print, .print-overlay-bar{ display:none !important; } }

/* Empty state */
.empty-state{ display:flex; flex-direction:column; align-items:center; gap:8px; padding:34px 10px; color:var(--ink-soft); text-align:center; }
.empty-title{ font-family:'Inter',sans-serif; font-size:13px; font-weight:600; }
.empty-hint{ font-family:'Inter',sans-serif; font-size:11.5px; }

.boot-screen{ display:flex; align-items:center; justify-content:center; gap:10px; height:100vh; font-family:'Inter',sans-serif; color:var(--ink-soft); background:var(--paper); }

@media (prefers-reduced-motion: reduce){ .bar, .chev{ transition:none; } .spin{ animation:none; } }
`;
