import { Check, Circle, X } from "lucide-react";
import { Spinner } from "./ui";

/** Vertical step list. `status` maps step key -> "active" | "done" | "error". */
export default function Progress({ steps, status, detail = {} }) {
  return (
    <ol className="progress">
      {steps.map((s) => {
        const st = status[s.key] || "idle";
        return (
          <li key={s.key} className={`progress-step ${st}`}>
            <span className="progress-icon">
              {st === "done" ? <Check size={13} /> : st === "active" ? <Spinner size={13} /> : st === "error" ? <X size={13} /> : <Circle size={9} />}
            </span>
            <span className="progress-label">
              {s.label}
              {detail[s.key] && <span className="muted small"> · {detail[s.key]}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
