import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Overview" },
  { href: "/daily", label: "Daily input" },
  { href: "/programme", label: "Programme" },
  { href: "/materials", label: "Materials" },
  { href: "/variations", label: "Variations" },
  { href: "/quality", label: "Checks" },
  { href: "/setup", label: "Setup" },
  { href: "/help", label: "Help" },
];

export function AppShell({
  active,
  projectName,
  statusDate,
  children,
  action,
}: {
  active: string;
  projectName: string;
  statusDate: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="topbar">
        <div className="brand-lockup" aria-label="Savannah Construction">
          <Image
            className="brand-logo"
            src="/savannah-logo.jpg"
            width={168}
            height={66}
            alt="Savannah Construction"
            priority
          />
        </div>
        <div className="project-identity">
          <span className="eyebrow">Active job</span>
          <strong>{projectName}</strong>
        </div>
        <div className="topbar-meta">
          <span className="status-date">Status date {statusDate}</span>
          {action}
          <Link
            className="button master-export"
            href="/api/export"
            title="Download the complete project, including audit history"
          >
            Export project
          </Link>
        </div>
      </header>

      <aside className="sidebar" aria-label="Primary navigation">
        <nav>
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active === item.href ? "page" : undefined}
              className={active === item.href ? "active" : ""}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">Public prototype</span>
          <p>Fictional Waikato retail project data</p>
        </div>
      </aside>

      <main id="main-content" className="main-content">
        <div className="demo-banner" role="note">
          <div>
            <strong>Public interactive demo</strong>
            <span>
              All project data is fictional. Changes are shared with other
              visitors and may be overwritten during testing.
            </span>
          </div>
          <a
            href="https://github.com/Matija-Miletic/Project-Control-System/issues/new"
            target="_blank"
            rel="noreferrer"
          >
            Give feedback
          </a>
        </div>
        {children}
      </main>
    </div>
  );
}
