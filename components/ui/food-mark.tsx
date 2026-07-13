import { foodType, type FoodType } from "@/lib/food-types";

// The bordered-square-with-a-dot is the mark Indian diners already know how to
// read, so it is the one we use everywhere — admin editor, POS and customer menu
// alike. Only the size changes between them.
export function FoodMark({ type, size = 15 }: { type: FoodType | string; size?: number }) {
  const cfg = foodType(type);
  return (
    <span
      title={cfg.label}
      aria-label={cfg.label}
      role="img"
      className="inline-flex items-center justify-center rounded-[4px] border-2 shrink-0"
      style={{ width: size, height: size, borderColor: cfg.color }}
    >
      <span
        className="rounded-full"
        style={{ width: size * 0.42, height: size * 0.42, background: cfg.color }}
      />
    </span>
  );
}
