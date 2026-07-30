"use client";

import Link from "next/link";

export function PageExports({ scope }: { scope: string }) {
  return (
    <div className="export-actions" aria-label="Export options">
      <Link
        className="button quiet"
        href={`/api/export?format=csv&scope=${scope}`}
      >
        Export CSV
      </Link>
      <button
        className="button quiet"
        type="button"
        onClick={() => window.print()}
      >
        Export PDF
      </button>
    </div>
  );
}
