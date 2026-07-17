import type { StatusStyle } from "@/lib/status-colors";

/**
 * A small "3 free" / "2 cleaning" count, tinted with the tone it refers to.
 *
 * Shared by the Tables, Walk-ins and Rooms grids so their summaries read identically and
 * pick up the same status palette the cards use — the header and the grid should teach each
 * other, not use two different visual languages for the same fact.
 *
 * `tone` takes a StatusStyle (or any {color, soft}) rather than a colour name, so it inherits
 * the token indirection and flips in dark mode with no work here.
 */
export function CountPill({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: Pick<StatusStyle, "color" | "soft">;
}) {
  return (
    <span
      // A hairline in the tone's own colour: on a white canvas the soft tint alone left the
      // pill with no edge, which is most of why light mode read as flat.
      className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded-full whitespace-nowrap border"
      style={{ background: tone.soft, color: tone.color, borderColor: tone.color }}
    >
      <span className="tabular font-medium">{n}</span>
      {label}
    </span>
  );
}
