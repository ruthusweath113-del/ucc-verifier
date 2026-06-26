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

interface AttachmentCheck {
  name: string;
  present: boolean;
}

interface ExtractedData {
  debtorName?: string;
  recordingDate?: string;
  propertyAddress?: string;
  loanAmount?: string;
  securedPartyName?: string;
  lenderName?: string;
  seriesNumber?: string;
  uccNumber?: string;
  receiptNumber?: string;
  referencedAttachments?: string[];
  presentAttachments?: string[];
  recordingLevel?: string;
  recordingOffice?: string;
}

interface Results {
  verifications: Verification[];
  extracted: ExtractedData;
  attachmentChecks: AttachmentCheck[];
  isCountyRecording: boolean;
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

const dateMatch = (userDate: string, docDate: string): boolean => {
  if (!userDate || !docDate) return false;
  const closing = new Date(userDate);
  const recording = new Date(docDate);
  if (isNaN(closing.getTime()) || isNaN(recording.getTime())) return false;
  return recording >= closing;
};

const STATUS = {
  match:    { bg: "#d1fae5", color: "#065f46", icon: "✓", label: "Match" },
  mismatch: { bg: "#fee2e2", color: "#991b1b", icon: "✗", label: "Mismatch" },
  notfound: { bg: "#fef3c7", color: "#92400e", icon: "!", label: "Not found" },
  present:  { bg: "#d1fae5", color: "#065f46", icon: "✓", label: "Present" },
  missing:  { bg: "#fee2e2", color: "#991b1b", icon: "✗", label: "Missing" },
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

export default function UCCVerifier() {
  const [form, setForm] = useState({ entityName: "", closingDate: "", loanAmount: "", propertyAddress: "" });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
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
    if (!file) { setError("Please upload a UCC document."); return; }
    setLoading(true); setError(null); setResults(null);
    try {
      // Step 1: render PDF pages to canvas using PDF.js (browser)
      setStatusMsg("Loading PDF...");
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs";
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

      // Step 2: OCR each page with Tesseract (browser)
      setStatusMsg("Loading OCR engine...");
      const { createWorker } = await import("tesseract.js");
      const ocrWorker = await createWorker("eng");

      let fullText = "";
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        setStatusMsg(`Reading page ${pageNum} of ${pdf.numPages}...`);
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvasContext: ctx as unknown as object, viewport }).promise;
        const { data: { text } } = await ocrWorker.recognize(canvas);
        fullText += text + "\n";
      }
      await ocrWorker.terminate();

      // Step 3: send extracted text to API for verification
      setStatusMsg("Verifying...");
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, fields: form }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      const parsed: ExtractedData = json.data;

      const verifications: Verification[] = [
        {
          label: "Entity Name",
          userValue: form.entityName,
          docValue: parsed.debtorName ?? null,
          status: !form.entityName ? "notfound" : !parsed.debtorName ? "notfound" : fuzzyMatch(form.entityName, parsed.debtorName) ? "match" : "mismatch"
        },
        {
          label: "Closing Date",
          userValue: form.closingDate,
          docValue: parsed.recordingDate ?? null,
          status: !form.closingDate ? "notfound" : !parsed.recordingDate ? "notfound" : dateMatch(form.closingDate, parsed.recordingDate) ? "match" : "mismatch",
          note: parsed.recordingDate && form.closingDate && !dateMatch(form.closingDate, parsed.recordingDate) ? "Recording date must be on or after closing date" : null
        },
        {
          label: "Property Address",
          userValue: form.propertyAddress,
          docValue: parsed.propertyAddress ?? null,
          status: !form.propertyAddress ? "notfound" : !parsed.propertyAddress ? "notfound" : addressMatch(form.propertyAddress, parsed.propertyAddress) ? "match" : "mismatch"
        },
        ...(parsed.loanAmount ? [{
          label: "Loan Amount",
          userValue: form.loanAmount ? `$${parseFloat(form.loanAmount).toLocaleString()}` : null,
          docValue: parsed.loanAmount,
          status: (!form.loanAmount ? "notfound" : fuzzyMatch(form.loanAmount.replace(/[^0-9.]/g, ""), parsed.loanAmount.replace(/[^0-9.]/g, "")) ? "match" : "mismatch") as StatusKey
        }] : [])
      ];

      const attachmentChecks: AttachmentCheck[] = (parsed.referencedAttachments ?? [])
        .filter(att => !fuzzyMatch(att, "rider to ucc"))
        .map(att => ({
          name: att,
          present: (parsed.presentAttachments ?? []).some(p => fuzzyMatch(p, att))
        }));

      const isCountyRecording = parsed.recordingLevel?.toLowerCase() === "county";
      setResults({ verifications, extracted: parsed, attachmentChecks, isCountyRecording });
    } catch (err) {
      setError("Failed to parse document: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const allGood = results && results.verifications.filter(v => v.userValue).every(v => v.status === "match") && results.attachmentChecks.every(a => a.present) && results.isCountyRecording;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "2rem", paddingBottom: "1.25rem", borderBottom: "1px solid #e5e7eb" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>← Back</span>
        </Link>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1e3a5f", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: "#fff", fontSize: 20 }}>📄</span>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#111827" }}>UCC Document Verifier</p>
          <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>County filing verification tool</p>
        </div>
      </div>

      {/* Form */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: "1rem" }}>
        <div style={{ padding: "12px 16px", background: "#1e3a5f" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#e0f2fe" }}>📋 Filing details</p>
        </div>
        <div style={{ padding: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <Field label="Entity Name" placeholder="e.g. 21 Kathy, LLC" value={form.entityName} onChange={set("entityName")} required />
            <Field label="Closing Date" placeholder="e.g. 05/19/2026 or May 19, 2026" value={form.closingDate} onChange={set("closingDate")} required />
            <Field label="Loan Amount (optional)" placeholder="e.g. 500000" type="number" value={form.loanAmount} onChange={set("loanAmount")} />
            <div style={{ display: "flex", alignItems: "center" }}>
              <p style={{ margin: 0, fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>Verified only if listed in the document.</p>
            </div>
          </div>
          <Field label="Property Address" placeholder="e.g. 21 Kathy Court, Northport, NY 11768" value={form.propertyAddress} onChange={set("propertyAddress")} required />
        </div>
      </div>

      {/* Upload */}
      <label htmlFor="ucc-file-input" style={{ display: "block", border: file ? "2px solid #3b82f6" : "2px dashed #d1d5db", borderRadius: 12, padding: "1.5rem", textAlign: "center", cursor: "pointer", marginBottom: "1rem", background: file ? "#eff6ff" : "#f9fafb" }}>
        <p style={{ fontSize: 28, margin: "0 0 6px" }}>☁️</p>
        {file
          ? <><p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#1d4ed8" }}>{file.name}</p><p style={{ margin: "3px 0 0", fontSize: 12, color: "#3b82f6" }}>Click to replace</p></>
          : <><p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#374151" }}>Upload UCC county document</p><p style={{ margin: "3px 0 0", fontSize: 12, color: "#6b7280" }}>PDF only · Click to browse</p></>
        }
        <input id="ucc-file-input" ref={fileRef} type="file" accept=".pdf" onChange={handleFile} style={{ display: "none" }} />
      </label>

      {error && <div style={{ marginBottom: "1rem", padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>{error}</div>}

      <button onClick={verify} disabled={loading || !file}
        style={{ width: "100%", padding: "11px", fontSize: 14, fontWeight: 500, marginBottom: "2rem", cursor: loading || !file ? "not-allowed" : "pointer", opacity: loading || !file ? 0.5 : 1, background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8 }}>
        {loading ? `⏳ ${statusMsg || "Analysing..."}` : "🔍 Verify document"}
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
                {allGood ? "All fields verified successfully. Document looks good." : "One or more fields did not match or attachments are missing."}
              </p>
            </div>
          </div>

          {/* Verification table */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: "1.25rem" }}>
            <div style={{ padding: "10px 16px", background: "#1e3a5f" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#e0f2fe" }}>✅ Verification results</p>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "22%" }} />
                <col style={{ width: "25%" }} />
                <col style={{ width: "33%" }} />
                <col style={{ width: "20%" }} />
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
                {results.attachmentChecks.map((a, i) => (
                  <tr key={"att" + i} style={{ borderBottom: "1px solid #e5e7eb", background: !a.present ? "#fff5f5" : "#f0fdf4" }}>
                    <td style={{ padding: "11px 14px", fontWeight: 500, color: "#111827", verticalAlign: "top" }}>Attachment</td>
                    <td style={{ padding: "11px 14px", color: "#6b7280", verticalAlign: "top" }}>{a.name}</td>
                    <td style={{ padding: "11px 14px", color: "#111827", verticalAlign: "top" }}>Referenced in document</td>
                    <td style={{ padding: "11px 14px", verticalAlign: "top" }}><Badge status={a.present ? "present" : "missing"} /></td>
                  </tr>
                ))}
                <tr style={{ background: results.isCountyRecording ? "#f0fdf4" : "#fff5f5" }}>
                  <td style={{ padding: "11px 14px", fontWeight: 500, color: "#111827", verticalAlign: "top" }}>UCC County Recording</td>
                  <td style={{ padding: "11px 14px", color: "#6b7280", verticalAlign: "top" }}>Must be county</td>
                  <td style={{ padding: "11px 14px", color: "#111827", verticalAlign: "top" }}>
                    {results.extracted.recordingOffice || (results.isCountyRecording ? "County recording" : "State recording — must be county")}
                  </td>
                  <td style={{ padding: "11px 14px", verticalAlign: "top" }}><Badge status={results.isCountyRecording ? "present" : "missing"} /></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Extracted info */}
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", background: "#1e3a5f" }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#e0f2fe" }}>📁 Extracted filing info</p>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {([
                  ["Recording date", results.extracted.recordingDate],
                  ["Secured party", results.extracted.securedPartyName],
                  ["Lender name", results.extracted.lenderName],
                  ["Series number", results.extracted.seriesNumber],
                  ["UCC number", results.extracted.uccNumber],
                  ["Receipt number", results.extracted.receiptNumber],
                  ["Loan amount in document", results.extracted.loanAmount],
                ] as [string, string | undefined][]).map(([label, val], i, arr) => (
                  <tr key={label} style={{ borderBottom: i < arr.length - 1 ? "1px solid #e5e7eb" : "none", background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                    <td style={{ padding: "10px 16px", color: "#6b7280", width: "38%", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</td>
                    <td style={{ padding: "10px 16px", fontWeight: 500, color: "#111827" }}>{val || <span style={{ fontStyle: "italic", color: "#d1d5db", fontWeight: 400 }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={reset} style={{ width: "100%", marginTop: "1.25rem", padding: "11px", fontSize: 14, fontWeight: 500, cursor: "pointer", background: "transparent", color: "#1e3a5f", border: "2px solid #1e3a5f", borderRadius: 8 }}>
            🔄 Verify another document
          </button>
        </>
      )}
    </div>
  );
}
