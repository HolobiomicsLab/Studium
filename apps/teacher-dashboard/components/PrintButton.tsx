"use client";

export default function PrintButton({ label }: { label: string }) {
  return <button type="button" className="secondary-button print-action" onClick={() => window.print()}>{label}</button>;
}
