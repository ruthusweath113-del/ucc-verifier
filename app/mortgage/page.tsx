"use client";
import { useState, useRef } from "react";
import type { ChangeEvent, ChangeEventHandler } from "react";
import Link from "next/link";

type StatusKey = keyof typeof STATUS;

interface Verification {
  label: string;
  userValue: string | null;
  docValue: string | null;
  status: StatusKey;
  note?: string | null;
}

interface ParsedMortgage {
  recordingDate?: string;
  recordingInstrumentNumber?: string;
  recordingCounty?: string;
  documentType?: string;
  isMortgageDocument?: boolean;
  closingDate?: string;
  borrowerName?: string;
  lenderName?: string;
  mortgageeName?: string;
  returnToParty?: string;
  propertyAddress?: string;
  loanAmount?: string;
  scheduleAPresent?: boolean;
  legalDescriptionPresent?: boolean;
  legalDescription?: string;
  scheduleBPresent?: boolean;
  scheduleBContent?: string;
  borrowerSignaturePresent?: boolean;
  notarySignaturePresent?: boolean;
  notaryStampPresent?: boolean;
  signaturePageClosingDate?: string;
  totalPages?: number;
  allPagesPresent?: boolean;
  isRecorded?: boolean;
}

interface Results {
  verifications: Verification[];
  checks: { label: string; pass: boolean; note?: string }[];
  extracted: ParsedMortgage;
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
  // strip parenthetical content e.g. "(LOT 52 OF ROCK GARDENS UNIT 5)"
  const strip = (s: string) => s.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return fuzzyMatch(strip(a), strip(b));
};

type YMD = { y: number; m: number; d: number };

const parseDate = (s: string): YMD | null => {
  if (!s) return null;
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  // MM/DD/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { y: +m[3], m: +m[1], d: +m[2] };
  // fallback: let JS parse it and extract local date parts
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
  return null;
};

const datesEqual = (a: string, b: string): boolean => {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return false;
  return da.y === db.y && da.m === db.m && da.d === db.d;
};

const dateOnOrAfter = (baseDate: string, checkDate: string): boolean => {
  const base = parseDate(baseDate), check = parseDate(checkDate);
  if (!base || !check) return false;
  if (check.y !== base.y) return check.y > base.y;
  if (check.m !== base.m) return check.m > base.m;
  return check.d >= base.d;
};

const STATUS = {
  match:    { bg: "#d1fae5", color: "#065f46", icon: "✓", label: "Match" },
  mismatch: { bg: "#fee2e2", color: "#991b1b", icon: "✗", label: "Mismatch" },
  notfound: { bg: "#fef3c7", color: "#92400e", icon: "!", label: "Not found" },
  pass:     { bg: "#d1fae5", color: "#065f46", icon: "✓", label: "Pass" },
  fail:     { bg: "#fee2e2", color: "#991b1b", icon: "✗", label: "Fail" },
  warn:     { bg: "#fef3c7", color: "#92400e", icon: "!", label: "Warning" },
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
  label: string;
  placeholder?: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  type?: string;
  required?: boolean;
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

export default function MortgageVerifier() {
  const [form, setForm] = useState({ entityName: "", closingDate: "", loanAmount: "", propertyAddress: "" });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const reset = () => {
    setForm({ entityName: "", closingDate: "", loanAmount: "", propertyAddress: "" });
    setFile(null); setResults(null); setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && f.type === "application/pdf") { setFile(f); setResults(null); setError(null); }
    else setError("Please upload a PDF file.");
  };

  const verify = async () => {
    if (!file) { setError("Please upload a mortgage document."); return; }
    setLoading(true); setError(null); setResults(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fields", JSON.stringify(form));

      const res = await fetch("/api/verify-mortgage", { method: "POST", body: formData });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      const p: ParsedMortgage = json.data;

      // Field verifications (match/mismatch)
      const verifications: Verification[] = [
        {
          label: "Entity / Borrower Name",
          userValue: form.entityName,
          docValue: p.borrowerName ?? null,
          status: !form.entityName ? "notfound" : !p.borrowerName ? "notfound" : fuzzyMatch(form.entityName, p.borrowerName) ? "match" : "mismatch"
        },
        {
          label: "Closing Date",
          userValue: form.closingDate,
          docValue: p.closingDate ?? null,
          status: !form.closingDate ? "notfound" : !p.closingDate ? "notfound" : datesEqual(form.closingDate, p.closingDate) ? "match" : "mismatch"
        },
        {
          label: "Loan Amount",
          userValue: form.loanAmount ? `$${parseFloat(form.loanAmount).toLocaleString()}` : null,
          docValue: p.loanAmount ?? null,
          status: !form.loanAmount ? "notfound" : !p.loanAmount ? "notfound" : fuzzyMatch(form.loanAmount.replace(/[^0-9.]/g, ""), p.loanAmount.replace(/[^0-9.]/g, "")) ? "match" : "mismatch"
        },
        {
          label: "Property Address",
          userValue: form.propertyAddress,
          docValue: p.propertyAddress ?? null,
          status: !form.propertyAddress ? "notfound" : !p.propertyAddress ? "notfound" : addressMatch(form.propertyAddress, p.propertyAddress) ? "match" : "mismatch"
        },
        {
          label: "Recording Date",
          userValue: form.closingDate ? `On or after ${form.closingDate}` : null,
          docValue: p.recordingDate ?? null,
          status: !p.recordingDate ? "notfound" : !form.closingDate ? "notfound" : dateOnOrAfter(form.closingDate, p.recordingDate) ? "match" : "mismatch",
          note: p.recordingDate && form.closingDate && !dateOnOrAfter(form.closingDate, p.recordingDate) ? "Recording date must be on or after closing date" : null
        },
        {
          label: "Signature Page Date",
          userValue: form.closingDate,
          docValue: p.signaturePageClosingDate ?? null,
          status: !p.signaturePageClosingDate ? "notfound" : !form.closingDate ? "notfound" : datesEqual(form.closingDate, p.signaturePageClosingDate) ? "match" : "mismatch"
        },
      ];

      // Presence checks (pass/fail)
      const checks = [
        { label: "Document is recorded", pass: p.isRecorded === true },
        { label: "Document is a mortgage/deed", pass: p.isMortgageDocument === true, note: p.documentType ?? undefined },
        { label: "Borrower signature", pass: p.borrowerSignaturePresent === true },
        { label: "Notary signature", pass: p.notarySignaturePresent === true },
        { label: "Notary stamp / seal", pass: p.notaryStampPresent === true },
        { label: "Schedule A present", pass: p.scheduleAPresent === true },
        { label: "Legal description present", pass: p.legalDescriptionPresent === true },
        { label: "All pages present", pass: p.allPagesPresent === true, note: p.totalPages ? `Total pages: ${p.totalPages}` : undefined },
      ];

      setResults({ verifications, checks, extracted: p });
    } catch (err) {
      setError("Failed to parse document: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const allGood = results &&
    results.verifications.filter(v => v.userValue).every(v => v.status === "match") &&
    results.checks.every(c => c.pass);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem", paddingBottom: "1.25rem", borderBottom: "1px solid #e5e7eb" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>← Back</span>
        </Link>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "#065f46", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", fontSize: 20 }}>🏠</span>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#111827" }}>Recorded Mortgage Verifier</p>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Commercial mortgage verification tool</p>
        </div>
      </div>

      {/* Form */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: "1rem" }}>
        <div style={{ padding: "12px 16px", background: "#065f46" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#d1fae5" }}>📋 Loan details</p>
        </div>
        <div style={{ padding: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Entity / Borrower Name" placeholder="e.g. Stonecabi Corp" value={form.entityName} onChange={set("entityName")} required />
            <Field label="Closing Date" placeholder="e.g. 05/19/2026 or May 19, 2026" value={form.closingDate} onChange={set("closingDate")} required />
            <Field label="Loan Amount" placeholder="e.g. 325000" type="number" value={form.loanAmount} onChange={set("loanAmount")} required />
            <div />
          </div>
          <Field label="Property Address" placeholder="e.g. 19910 Longleaf Drive, Lutz, FL 33548" value={form.propertyAddress} onChange={set("propertyAddress")} required />
        </div>
      </div>

      {/* Upload */}
      <label htmlFor="mtg-file-input" style={{ display: "block", border: file ? "2px solid #059669" : "2px dashed #d1d5db", borderRadius: 12, padding: "1.5rem", textAlign: "center", cursor: "pointer", marginBottom: "1rem", background: file ? "#ecfdf5" : "#f9fafb" }}>
        <p style={{ fontSize: 28, margin: "0 0 6px" }}>☁️</p>
        {file
          ? <><p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#065f46" }}>{file.name}</p><p style={{ margin: "3px 0 0", fontSize: 12, color: "#059669" }}>Click to replace</p></>
          : <><p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#374151" }}>Upload recorded mortgage document</p><p style={{ margin: "3px 0 0", fontSize: 12, color: "#6b7280" }}>PDF only · Click to browse</p></>
        }
        <input id="mtg-file-input" ref={fileRef} type="file" accept=".pdf" onChange={handleFile} style={{ display: "none" }} />
      </label>

      {error && <div style={{ marginBottom: "1rem", padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>{error}</div>}

      <button onClick={verify} disabled={loading || !file}
        style={{ width: "100%", padding: "11px", fontSize: 14, fontWeight: 500, marginBottom: "2rem", cursor: loading || !file ? "not-allowed" : "pointer", opacity: loading || !file ? 0.5 : 1, background: "#065f46", color: "#fff", border: "none", borderRadius: 8 }}>
        {loading ? "⏳ Analysing document…" : "🔍 Verify document"}
      </button>

      {results && (
        <>
          {/* Verdict */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "1.25rem 1.5rem", marginBottom: "1.25rem", borderRadius: 12, background: allGood ? "#d1fae5" : "#fee2e2", border: `2px solid ${allGood ? "#6ee7b7" : "#fca5a5"}` }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: allGood ? "#059669" : "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 24, color: "#fff" }}>{allGood ? "✓" : "✗"}</span>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: allGood ? "#065f46" : "#7f1d1d" }}>
                {allGood ? "No issues found" : "Issues found"}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: allGood ? "#047857" : "#991b1b" }}>
                {allGood ? "All fields verified. Document looks good." : "One or more checks failed or fields did not match."}
              </p>
            </div>
          </div>

          {/* Field verifications */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: "1.25rem" }}>
            <div style={{ padding: "10px 16px", background: "#065f46" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#d1fae5" }}>✅ Field verification</p>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "22%" }} /><col style={{ width: "25%" }} /><col style={{ width: "33%" }} /><col style={{ width: "20%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Field", "Your input", "Document value", "Status"].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 500, color: "#6b7280", borderBottom: "1px solid #e5e7eb", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.verifications.map((v, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e5e7eb", background: v.status === "mismatch" ? "#fff5f5" : v.status === "match" ? "#f0fdf4" : "transparent" }}>
                    <td style={{ padding: "11px 14px", fontWeight: 500, color: "#111827", verticalAlign: "top" }}>{v.label}</td>
                    <td style={{ padding: "11px 14px", color: "#6b7280", verticalAlign: "top", wordBreak: "break-word" }}>{v.userValue || <span style={{ fontStyle: "italic", color: "#d1d5db" }}>—</span>}</td>
                    <td style={{ padding: "11px 14px", color: "#111827", verticalAlign: "top", wordBreak: "break-word" }}>
                      {v.docValue || <span style={{ fontStyle: "italic", color: "#d1d5db" }}>Not found</span>}
                      {v.note && <span style={{ display: "block", fontSize: 11, color: "#b45309", marginTop: 3 }}>{v.note}</span>}
                    </td>
                    <td style={{ padding: "11px 14px", verticalAlign: "top" }}><Badge status={v.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Presence checks */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: "1.25rem" }}>
            <div style={{ padding: "10px 16px", background: "#065f46" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#d1fae5" }}>🔎 Document checks</p>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {results.checks.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e5e7eb", background: !c.pass ? "#fff5f5" : "#f0fdf4" }}>
                    <td style={{ padding: "11px 14px", fontWeight: 500, color: "#111827", width: "60%" }}>
                      {c.label}
                      {c.note && <span style={{ display: "block", fontSize: 11, color: "#6b7280", fontWeight: 400, marginTop: 2 }}>{c.note}</span>}
                    </td>
                    <td style={{ padding: "11px 14px" }}><Badge status={c.pass ? "pass" : "fail"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Extracted info */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", background: "#065f46" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#d1fae5" }}>📁 Extracted document info</p>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {([
                  ["Document type", results.extracted.documentType],
                  ["Instrument #", results.extracted.recordingInstrumentNumber],
                  ["Recording date", results.extracted.recordingDate],
                  ["County", results.extracted.recordingCounty],
                  ["Lender", results.extracted.lenderName],
                  ["Mortgagee", results.extracted.mortgageeName],
                  ["After recording return to", results.extracted.returnToParty],
                  ["Schedule B (Encumbrances)", results.extracted.scheduleBContent],
                ] as [string, string | undefined][]).map(([label, val], i, arr) => (
                  <tr key={label} style={{ borderBottom: i < arr.length - 1 ? "1px solid #e5e7eb" : "none", background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                    <td style={{ padding: "10px 16px", color: "#6b7280", width: "38%", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 500, color: "#111827" }}>{val || <span style={{ fontStyle: "italic", color: "#d1d5db", fontWeight: 400 }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={reset} style={{ width: "100%", marginTop: "1.25rem", padding: "11px", fontSize: 14, fontWeight: 500, cursor: "pointer", background: "transparent", color: "#065f46", border: "2px solid #065f46", borderRadius: 8 }}>
            🔄 Verify another document
          </button>
        </>
      )}
    </div>
  );
}
