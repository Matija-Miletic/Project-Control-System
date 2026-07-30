import Link from "next/link";

export function HelpTip({
  topic,
  summary,
}: {
  topic: string;
  summary: string;
}) {
  return (
    <Link
      className="help-tip"
      href={`/help#${topic}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`Help: ${summary}`}
      data-help={summary}
    >
      ?
    </Link>
  );
}
