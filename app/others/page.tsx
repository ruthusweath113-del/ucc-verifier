"use client";
import Link from "next/link";

const tools = [
  {
    href: "/verify-all",
    icon: "⚡",
    title: "Verify All Documents",
    description: "Enter details once and verify UCC, Mortgage, and ALR together in one shot.",
    color: "#111827",
  },
  {
    href: "/mortgage",
    icon: "🏠",
    title: "Recorded Mortgage",
    description: "Verify recorded mortgage documents — borrower, lender, loan amount, and recording details.",
    color: "#065f46",
  },
  {
    href: "/alr",
    icon: "📋",
    title: "Assignment of Leases & Rents",
    description: "Verify ALR documents — assignor, assignee, loan amount, signatures, and recording details.",
    color: "#7c3aed",
  },
];

export default function Others() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 600, margin: "0 auto", padding: "4rem 1rem" }}>

      <div style={{ marginBottom: "2rem" }}>
        <Link href="/" style={{ fontSize: 13, color: "#6b7280", textDecoration: "none" }}>← Back</Link>
      </div>

      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: "#374151", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem" }}>
          <span style={{ fontSize: 28 }}>📁</span>
        </div>
        <h1 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 700, color: "#111827" }}>Other Documents</h1>
        <p style={{ margin: 0, fontSize: 15, color: "#6b7280" }}>Select a document type to verify</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {tools.map(tool => (
          <Link key={tool.href} href={tool.href} style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "1.5rem", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, cursor: "pointer", transition: "box-shadow 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)")}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: tool.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 26 }}>{tool.icon}</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600, color: "#111827" }}>{tool.title}</p>
                <p style={{ margin: 0, fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>{tool.description}</p>
              </div>
              <span style={{ fontSize: 20, color: "#d1d5db", flexShrink: 0 }}>→</span>
            </div>
          </Link>
        ))}
      </div>

    </div>
  );
}
