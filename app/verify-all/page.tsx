"use client";
import { useState, useRef } from "react";
import type { ChangeEvent, ChangeEventHandler } from "react";
import Link from "next/link";

type StatusKey = keyof typeof STATUS;

const STATUS = {
  match:    { bg: "#d1fae5", color: "#065f46", icon: "✓", label: "Match" },
  mismatch: { bg: "#fee2e2", color: "#991b1b", icon: "✗", label: "Mismatch" },
  notfound: { bg: "#fef3c7", color: "#92400e", icon: "!", label: "Not found" },
  pass:     { bg: "#d1fae5", color: "#065f46", icon: "✓", label: "Pass" },
  fail:     { bg: "#fee2e2", color: "#991b1b", icon: "✗", label: "Fail" },
};

interface Verification {
  label: string;
  userValue: string | null;
  docValue: string | null;
  status: StatusKey;
  note?: string | null;
}

interface Check {
  label: string;
  pass: boolean;
  note?: string;
}

interface DocResult {
  type: "UCC" | "Mortgage" | "ALR";
  verifications: Verification[];
  checks: Check[];
  extracted: Record<string, string | undefined>;
  allGood: boolean;
}

const fuzzyMatch = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
};

const addressMatch = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  const strip = (s: string) => s.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return fuzzyMatch(strip(a), strip(b));
};

type YMD = { y: number; m: number; d: number };
const parseDate = (s: string): YMD | null => {
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { y: +m[3], m: +m[1], d: +m[2] };
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
  return null;
};
const datesEqual = (a: string, b: string): boolean => {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return false;
  return da.y === db.y && da.m === db.m && da.d === db.d;
};
const dateOnOrAfter = (base: string, check: string): boolean => {
  const b = parseDate(base), c = parseDate(check);
  if (!b || !c) return false;
  if (c.y !== b.y) return c.y > b.y;
  if (c.m !== b.m) return c.m > b.m;
  return c.d >= b.d;
};

const Badge = ({ status }: { status: string }) => {
  const s = (STATUS as Record<string, { bg: string; color: string; icon: string; label: string }>)[status] ?? STATUS.notfound;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, background: s.bg, color: s.color, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
      {s.icon} {s.label}
    </span>
  );
};

interface FieldProps {
  label: string; placeholder?: string; value: string;
  onChange: ChangeEventHandler<HTMLInputElement>; type?: string; required?: boolean;
}
const Field = ({ label, placeholder, value, onChange, type = "text", required }: FieldProps) => (
  <div>
    <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {label}{required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
    </label>
    <input type={type} placeholder={placeholder} value={value} onChange={onChange}
      style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, padding: "8px 12px", border: "1px solid #d1d5db", fontSize: 14, outline: "none" }} />
  </div>
);

const DOCS = [
  { key: "ucc",      label: "UCC Document",                  color: "#1e3a5f", icon: "📄", endpoint: "/api/verify" },
  { key: "mortgage", label: "Recorded Mortgage",             color: "#065f46", icon: "🏠", endpoint: "/api/verify-mortgage" },
  { key: "alr",      label: "Assignment of Leases & Rents",  color: "#7c3aed", icon: "📋", endpoint: "/api/verify-alr" },
];

interface UploadBoxProps {
  docKey: string; label: string; color: string; icon: string;
  file: File | null; onChange: (f: File | null) => void;
}
const UploadBox = ({ docKey, label, color, icon, file, onChange }: UploadBoxProps) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label htmlFor={`file-${docKey}`} style={{ display: "block", border: file ? `2px solid ${color}` : "2px dashed #d1d5db", borderRadius: 12, padding: "1.25rem", textAlign: "center", cursor: "pointer", background: file ? "#f8f8ff" : "#f9fafb", flex: 1 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: color, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px" }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <p style={{ margin: "0 0 2px", fontSize: 13, fontWeight: 600, color: "#111827" }}>{label}</p>
      {file
        ? <p style={{ margin: 0, fontSize: 11, color, fontWeight: 500 }}>{file.name}</p>
        : <p style={{ margin: 0, fontSize: 11, color: "#9ca3af" }}>Click to upload PDF</p>
      }
      <input id={`file-${docKey}`} ref={ref} type="file" accept=".pdf"
        onChange={e => onChange(e.target.files?.[0] ?? null)}
        style={{ display: "none" }} />
    </label>
  );
};

function buildUCCResult(form: Record<string, string>, p: Record<string, unknown>): DocResult {
  const verifications: Verification[] = [
    { label: "Entity Name", userValue: form.entityName, docValue: (p.debtorName as string) ?? null,
      status: !form.entityName ? "notfound" : !p.debtorName ? "notfound" : fuzzyMatch(form.entityName, p.debtorName as string) ? "match" : "mismatch" },
    { label: "Closing Date", userValue: form.closingDate, docValue: (p.recordingDate as string) ?? null,
      status: !form.closingDate ? "notfound" : !p.recordingDate ? "notfound" : dateOnOrAfter(form.closingDate, p.recordingDate as string) ? "match" : "mismatch",
      note: p.recordingDate && form.closingDate && !dateOnOrAfter(form.closingDate, p.recordingDate as string) ? "Recording date must be on or after closing date" : null },
    { label: "Property Address", userValue: form.propertyAddress, docValue: (p.propertyAddress as string) ?? null,
      status: !form.propertyAddress ? "notfound" : !p.propertyAddress ? "notfound" : addressMatch(form.propertyAddress, p.propertyAddress as string) ? "match" : "mismatch" },
    ...(p.loanAmount ? [{ label: "Loan Amount", userValue: form.loanAmount ? `$${parseFloat(form.loanAmount).toLocaleString()}` : null, docValue: p.loanAmount as string,
      status: (!form.loanAmount ? "notfound" : fuzzyMatch(form.loanAmount.replace(/[^0-9.]/g, ""), (p.loanAmount as string).replace(/[^0-9.]/g, "")) ? "match" : "mismatch") as StatusKey }] : [])
  ];
  const checks: Check[] = [];
  const allGood = verifications.filter(v => v.userValue).every(v => v.status === "match");
  return { type: "UCC", verifications, checks, extracted: {
    "Recording date": p.recordingDate as string, "Secured party": p.securedPartyName as string,
    "Lender": p.lenderName as string, "UCC number": p.uccNumber as string,
  }, allGood };
}

function buildMortgageResult(form: Record<string, string>, p: Record<string, unknown>): DocResult {
  const verifications: Verification[] = [
    { label: "Entity / Borrower", userValue: form.entityName, docValue: (p.borrowerName as string) ?? null,
      status: !form.entityName ? "notfound" : !p.borrowerName ? "notfound" : fuzzyMatch(form.entityName, p.borrowerName as string) ? "match" : "mismatch" },
    { label: "Closing Date", userValue: form.closingDate, docValue: (p.closingDate as string) ?? null,
      status: !form.closingDate ? "notfound" : !p.closingDate ? "notfound" : datesEqual(form.closingDate, p.closingDate as string) ? "match" : "mismatch" },
    { label: "Loan Amount", userValue: form.loanAmount ? `$${parseFloat(form.loanAmount).toLocaleString()}` : null, docValue: (p.loanAmount as string) ?? null,
      status: !form.loanAmount ? "notfound" : !p.loanAmount ? "notfound" : fuzzyMatch(form.loanAmount.replace(/[^0-9.]/g, ""), (p.loanAmount as string).replace(/[^0-9.]/g, "")) ? "match" : "mismatch" },
    { label: "Property Address", userValue: form.propertyAddress, docValue: (p.propertyAddress as string) ?? null,
      status: !form.propertyAddress ? "notfound" : !p.propertyAddress ? "notfound" : addressMatch(form.propertyAddress, p.propertyAddress as string) ? "match" : "mismatch" },
    { label: "Recording Date", userValue: form.closingDate ? `On or after ${form.closingDate}` : null, docValue: (p.recordingDate as string) ?? null,
      status: !p.recordingDate ? "notfound" : !form.closingDate ? "notfound" : dateOnOrAfter(form.closingDate, p.recordingDate as string) ? "match" : "mismatch",
      note: p.recordingDate && form.closingDate && !dateOnOrAfter(form.closingDate, p.recordingDate as string) ? "Recording date must be on or after closing date" : null },
    { label: "Signature Page Date", userValue: form.closingDate, docValue: (p.signaturePageClosingDate as string) ?? null,
      status: !p.signaturePageClosingDate ? "notfound" : !form.closingDate ? "notfound" : datesEqual(form.closingDate, p.signaturePageClosingDate as string) ? "match" : "mismatch" },
  ];
  const checks: Check[] = [
    { label: "Document is recorded", pass: p.isRecorded === true },
    { label: "Document is a mortgage/deed", pass: p.isMortgageDocument === true, note: p.documentType as string },
    { label: "Borrower signature", pass: p.borrowerSignaturePresent === true },
    { label: "Notary signature", pass: p.notarySignaturePresent === true },
    { label: "Notary stamp / seal", pass: p.notaryStampPresent === true },
    { label: "Schedule A present", pass: p.scheduleAPresent === true },
    { label: "Legal description present", pass: p.legalDescriptionPresent === true },
    { label: "All pages present", pass: p.allPagesPresent === true, note: p.totalPages ? `Total pages: ${p.totalPages}` : undefined },
  ];
  const allGood = verifications.filter(v => v.userValue).every(v => v.status === "match") && checks.every(c => c.pass);
  return { type: "Mortgage", verifications, checks, extracted: {
    "Instrument #": p.recordingInstrumentNumber as string, "Recording date": p.recordingDate as string,
    "County": p.recordingCounty as string, "Lender": p.lenderName as string,
    "Mortgagee": p.mortgageeName as string, "Return to": p.returnToParty as string,
  }, allGood };
}

function buildALRResult(form: Record<string, string>, p: Record<string, unknown>): DocResult {
  const verifications: Verification[] = [
    { label: "Entity / Assignor", userValue: form.entityName, docValue: (p.assignorName as string) ?? null,
      status: !form.entityName ? "notfound" : !p.assignorName ? "notfound" : fuzzyMatch(form.entityName, p.assignorName as string) ? "match" : "mismatch" },
    { label: "Closing Date", userValue: form.closingDate, docValue: (p.closingDate as string) ?? null,
      status: !form.closingDate ? "notfound" : !p.closingDate ? "notfound" : datesEqual(form.closingDate, p.closingDate as string) ? "match" : "mismatch" },
    { label: "Loan Amount", userValue: form.loanAmount ? `$${parseFloat(form.loanAmount).toLocaleString()}` : null, docValue: (p.loanAmount as string) ?? null,
      status: !form.loanAmount ? "notfound" : !p.loanAmount ? "notfound" : fuzzyMatch(form.loanAmount.replace(/[^0-9.]/g, ""), (p.loanAmount as string).replace(/[^0-9.]/g, "")) ? "match" : "mismatch" },
    { label: "Property Address", userValue: form.propertyAddress, docValue: (p.propertyAddress as string) ?? null,
      status: !form.propertyAddress ? "notfound" : !p.propertyAddress ? "notfound" : addressMatch(form.propertyAddress, p.propertyAddress as string) ? "match" : "mismatch" },
    { label: "Recording Date", userValue: form.closingDate ? `On or after ${form.closingDate}` : null, docValue: (p.recordingDate as string) ?? null,
      status: !p.recordingDate ? "notfound" : !form.closingDate ? "notfound" : dateOnOrAfter(form.closingDate, p.recordingDate as string) ? "match" : "mismatch",
      note: p.recordingDate && form.closingDate && !dateOnOrAfter(form.closingDate, p.recordingDate as string) ? "Recording date must be on or after closing date" : null },
    { label: "Signature Page Date", userValue: form.closingDate, docValue: (p.signaturePageClosingDate as string) ?? null,
      status: !p.signaturePageClosingDate ? "notfound" : !form.closingDate ? "notfound" : datesEqual(form.closingDate, p.signaturePageClosingDate as string) ? "match" : "mismatch" },
  ];
  const checks: Check[] = [
    { label: "Document is recorded", pass: p.isRecorded === true },
    { label: "Document is an ALR", pass: p.isALRDocument === true, note: p.documentType as string },
    { label: "Assignor signature", pass: p.assignorSignaturePresent === true },
    { label: "Notary signature", pass: p.notarySignaturePresent === true },
    { label: "Notary stamp / seal", pass: p.notaryStampPresent === true },
    { label: "Schedule A present", pass: p.scheduleAPresent === true },
    { label: "Legal description present", pass: p.legalDescriptionPresent === true },
    { label: "All pages present", pass: p.allPagesPresent === true, note: p.totalPages ? `Total pages: ${p.totalPages}` : undefined },
  ];
  const allGood = verifications.filter(v => v.userValue).every(v => v.status === "match") && checks.every(c => c.pass);
  return { type: "ALR", verifications, checks, extracted: {
    "Instrument #": p.recordingInstrumentNumber as string, "Recording date": p.recordingDate as string,
    "County": p.recordingCounty as string, "Assignee / Lender": p.assigneeName as string,
    "Return to": p.returnToParty as string,
  }, allGood };
}

const DOC_COLORS: Record<string, string> = { UCC: "#1e3a5f", Mortgage: "#065f46", ALR: "#7c3aed" };
const DOC_ICONS: Record<string, string> = { UCC: "📄", Mortgage: "🏠", ALR: "📋" };

function ResultSection({ result }: { result: DocResult }) {
  const color = DOC_COLORS[result.type];
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", marginBottom: "1.5rem" }}>
      {/* Doc header */}
      <div style={{ padding: "12px 16px", background: color, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>{DOC_ICONS[result.type]}</span>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#fff" }}>{result.type} Document</p>
        </div>
        <span style={{ fontSize: 20, color: result.allGood ? "#6ee7b7" : "#fca5a5" }}>{result.allGood ? "✓" : "✗"}</span>
      </div>

      {/* Field verifications */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "22%" }} /><col style={{ width: "25%" }} /><col style={{ width: "33%" }} /><col style={{ width: "20%" }} />
        </colgroup>
        <thead>
          <tr style={{ background: "#f9fafb" }}>
            {["Field", "Your input", "Document value", "Status"].map(h => (
              <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 11, fontWeight: 500, color: "#6b7280", borderBottom: "1px solid #e5e7eb", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.verifications.map((v, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: v.status === "mismatch" ? "#fff5f5" : v.status === "match" ? "#f0fdf4" : "transparent" }}>
              <td style={{ padding: "9px 14px", fontWeight: 500, color: "#111827", verticalAlign: "top" }}>{v.label}</td>
              <td style={{ padding: "9px 14px", color: "#6b7280", verticalAlign: "top", wordBreak: "break-word" }}>{v.userValue || <span style={{ fontStyle: "italic", color: "#d1d5db" }}>—</span>}</td>
              <td style={{ padding: "9px 14px", color: "#111827", verticalAlign: "top", wordBreak: "break-word" }}>
                {v.docValue || <span style={{ fontStyle: "italic", color: "#d1d5db" }}>Not found</span>}
                {v.note && <span style={{ display: "block", fontSize: 11, color: "#b45309", marginTop: 2 }}>{v.note}</span>}
              </td>
              <td style={{ padding: "9px 14px", verticalAlign: "top" }}><Badge status={v.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Checks */}
      {result.checks.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, borderTop: "1px solid #e5e7eb" }}>
          <tbody>
            {result.checks.map((c, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", background: !c.pass ? "#fff5f5" : "#f0fdf4" }}>
                <td style={{ padding: "9px 14px", fontWeight: 500, color: "#111827", width: "80%" }}>
                  {c.label}
                  {c.note && <span style={{ display: "block", fontSize: 11, color: "#6b7280", fontWeight: 400, marginTop: 2 }}>{c.note}</span>}
                </td>
                <td style={{ padding: "9px 14px" }}><Badge status={c.pass ? "pass" : "fail"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Extracted info */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, borderTop: "1px solid #e5e7eb", background: "#fafafa" }}>
        <tbody>
          {Object.entries(result.extracted).filter(([, v]) => v).map(([label, val], i) => (
            <tr key={label} style={{ borderBottom: i < Object.entries(result.extracted).filter(([, v]) => v).length - 1 ? "1px solid #f3f4f6" : "none" }}>
              <td style={{ padding: "8px 14px", color: "#9ca3af", width: "38%", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</td>
              <td style={{ padding: "8px 14px", color: "#374151", fontWeight: 500 }}>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function VerifyAll() {
  const [form, setForm] = useState({ entityName: "", closingDate: "", loanAmount: "", propertyAddress: "" });
  const [files, setFiles] = useState<Record<string, File | null>>({ ucc: null, mortgage: null, alr: null });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DocResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const setFile = (key: string) => (f: File | null) =>
    setFiles(p => ({ ...p, [key]: f }));

  const reset = () => {
    setForm({ entityName: "", closingDate: "", loanAmount: "", propertyAddress: "" });
    setFiles({ ucc: null, mortgage: null, alr: null });
    setResults([]); setError(null);
  };

  const verifyAll = async () => {
    const active = DOCS.filter(d => files[d.key]);
    if (active.length === 0) { setError("Please upload at least one document."); return; }
    setLoading(true); setError(null); setResults([]);

    try {
      const calls = active.map(async (doc) => {
        const formData = new FormData();
        formData.append("file", files[doc.key]!);
        formData.append("fields", JSON.stringify(form));
        const res = await fetch(doc.endpoint, { method: "POST", body: formData });
        const json = await res.json();
        if (!json.success) throw new Error(`${doc.label}: ${json.error}`);
        return { key: doc.key, data: json.data };
      });

      const responses = await Promise.all(calls);
      const built: DocResult[] = responses.map(r => {
        if (r.key === "ucc") return buildUCCResult(form, r.data);
        if (r.key === "mortgage") return buildMortgageResult(form, r.data);
        return buildALRResult(form, r.data);
      });
      setResults(built);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const anyFile = Object.values(files).some(Boolean);
  const overallGood = results.length > 0 && results.every(r => r.allGood);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem", paddingBottom: "1.25rem", borderBottom: "1px solid #e5e7eb" }}>
        <Link href="/" style={{ textDecoration: "none", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>← Back</span>
        </Link>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "#111827", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", fontSize: 20 }}>⚡</span>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#111827" }}>Verify All Documents</p>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Enter details once — verify UCC, Mortgage, and ALR together</p>
        </div>
      </div>

      {/* Form */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: "1rem" }}>
        <div style={{ padding: "12px 16px", background: "#111827" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#e5e7eb" }}>📋 Loan details</p>
        </div>
        <div style={{ padding: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Entity Name" placeholder="e.g. Stonecabi Corp" value={form.entityName} onChange={set("entityName")} required />
            <Field label="Closing Date" placeholder="e.g. 05/19/2026 or May 19, 2026" value={form.closingDate} onChange={set("closingDate")} required />
            <Field label="Loan Amount" placeholder="e.g. 325000" type="number" value={form.loanAmount} onChange={set("loanAmount")} required />
            <div />
          </div>
          <Field label="Property Address" placeholder="e.g. 19910 Longleaf Drive, Lutz, FL 33548" value={form.propertyAddress} onChange={set("propertyAddress")} required />
        </div>
      </div>

      {/* Upload boxes */}
      <div style={{ display: "flex", gap: 12, marginBottom: "1rem" }}>
        {DOCS.map(doc => (
          <UploadBox key={doc.key} docKey={doc.key} label={doc.label} color={doc.color} icon={doc.icon}
            file={files[doc.key]} onChange={setFile(doc.key)} />
        ))}
      </div>

      {error && <div style={{ marginBottom: "1rem", padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>{error}</div>}

      <button onClick={verifyAll} disabled={loading || !anyFile}
        style={{ width: "100%", padding: "11px", fontSize: 14, fontWeight: 500, marginBottom: "2rem", cursor: loading || !anyFile ? "not-allowed" : "pointer", opacity: loading || !anyFile ? 0.5 : 1, background: "#111827", color: "#fff", border: "none", borderRadius: 8 }}>
        {loading ? "⏳ Analysing documents…" : "⚡ Verify All"}
      </button>

      {results.length > 0 && (
        <>
          {/* Overall verdict */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "1.25rem 1.5rem", marginBottom: "1.5rem", borderRadius: 12, background: overallGood ? "#d1fae5" : "#fee2e2", border: `2px solid ${overallGood ? "#6ee7b7" : "#fca5a5"}` }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: overallGood ? "#059669" : "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 24, color: "#fff" }}>{overallGood ? "✓" : "✗"}</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: overallGood ? "#065f46" : "#7f1d1d" }}>
                {overallGood ? "All documents verified — no issues found" : "Issues found in one or more documents"}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: overallGood ? "#047857" : "#991b1b" }}>
                {results.length} document{results.length > 1 ? "s" : ""} checked
              </p>
            </div>
          </div>

          {results.map(r => <ResultSection key={r.type} result={r} />)}

          <button onClick={reset} style={{ width: "100%", marginTop: "0.5rem", padding: "11px", fontSize: 14, fontWeight: 500, cursor: "pointer", background: "transparent", color: "#111827", border: "2px solid #111827", borderRadius: 8 }}>
            🔄 Verify another loan
          </button>
        </>
      )}
    </div>
  );
}
