import Link from "next/link";
import type { ReactNode } from "react";

export function DemoChrome({
  number,
  title,
  subtitle,
  children,
}: {
  number: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="demo-page">
      <header className="demo-masthead">
        <Link className="wordmark" href="/" aria-label="Return to Lecture 4 demonstration index">
          <span className="wordmark-mark">IACV</span>
          <span>Lecture 04 demonstrations</span>
        </Link>
        <div className="demo-breadcrumb">
          <span>Demo {number}</span>
          <strong>{title}</strong>
        </div>
      </header>

      <section className="demo-title">
        <div>
          <p className="overline">Interactive demonstration · {number}</p>
          <h1>{title}</h1>
        </div>
        <p>{subtitle}</p>
      </section>

      {children}

      <footer className="demo-footer">
        <Link href="/">← All demonstrations</Link>
        <span>Interactive learning aid by Güney Tombak · Image Analysis and Computer Vision, Lecture 04 · not an official ETH Zürich website</span>
      </footer>
    </main>
  );
}

export function ModelBlock({
  title,
  children,
  tone = "blue",
}: {
  title: string;
  children: ReactNode;
  tone?: "blue" | "red" | "green" | "violet";
}) {
  return (
    <aside className={`model-block ${tone}`}>
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  );
}
