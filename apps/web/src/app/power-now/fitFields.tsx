import { fieldVisible, type FitField, type FitValue } from "@/lib/powerNowFit";

type Change = {
  answers: Record<string, FitValue>;
  disabled?: boolean;
  onChange: (id: string, value: FitValue) => void;
};

type Props = Change & { items: FitField[] };

function asText(value: FitValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function asList(value: FitValue | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function asGrid(value: FitValue | undefined): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function FitFields({ items, answers, disabled, onChange }: Props) {
  return (
    <>
      {items.map((field, index) => {
        if (!fieldVisible(field, answers)) return null;
        const showGroup = Boolean(field.group && field.group !== items[index - 1]?.group);
        return (
          <div key={field.id}>
            {showGroup ? <h3>{field.group}</h3> : null}
            <FitControl field={field} answers={answers} disabled={disabled} onChange={onChange} />
          </div>
        );
      })}
    </>
  );
}

function FitControl({ field, answers, disabled, onChange }: Change & { field: FitField }) {
  const required = field.required && !disabled;
  const helpId = `${field.id}-help`;
  const describedBy = field.help || field.note ? helpId : undefined;
  const choice = field.type === "single" || field.type === "scale" || field.type === "multi" || field.type === "grid";

  return (
    <div className="pn-field">
      {choice ? (
        <fieldset>
          <legend>{field.prompt}{field.required ? "" : " (optional)"}</legend>
          <FieldBody field={field} answers={answers} disabled={disabled} required={required} describedBy={describedBy} onChange={onChange} />
          <FieldHelp field={field} helpId={helpId} />
        </fieldset>
      ) : (
        <>
          <label htmlFor={field.id}>{field.prompt}{field.required ? "" : " (optional)"}</label>
          <FieldHelp field={field} helpId={helpId} />
          <FieldBody field={field} answers={answers} disabled={disabled} required={required} describedBy={describedBy} onChange={onChange} />
        </>
      )}
    </div>
  );
}

function FieldHelp({ field, helpId }: { field: FitField; helpId: string }) {
  if (!field.help && !field.note) return null;
  return (
    <span className="pn-help" id={helpId}>
      {field.help ? <span>{field.help}</span> : null}
      {field.note ? <span>{field.note}</span> : null}
    </span>
  );
}

function FieldBody({
  field,
  answers,
  disabled,
  required,
  describedBy,
  onChange,
}: {
  field: FitField;
  answers: Record<string, FitValue>;
  disabled?: boolean;
  required: boolean;
  describedBy?: string;
  onChange: (id: string, value: FitValue) => void;
}) {
  const value = answers[field.id];
  if (field.type === "long") {
    return (
      <textarea
        id={field.id}
        required={required}
        disabled={disabled}
        maxLength={field.maxLength ?? 4000}
        aria-describedby={describedBy}
        value={asText(value)}
        onChange={(event) => onChange(field.id, event.target.value)}
      />
    );
  }
  if (field.type === "short" || field.type === "url" || field.type === "datetime" || (field.type === "single" && field.options.length === 0)) {
    const inputType = field.type === "url" ? "url" : field.type === "datetime" ? "datetime-local" : "text";
    return (
      <input
        id={field.id}
        type={inputType}
        required={required}
        disabled={disabled}
        maxLength={field.maxLength ?? (field.type === "url" ? 500 : 300)}
        aria-describedby={describedBy}
        value={asText(value)}
        onChange={(event) => onChange(field.id, event.target.value)}
      />
    );
  }
  if (field.type === "multi") {
    const selected = asList(value);
    return (
      <div className="pn-choices" role="group" aria-describedby={describedBy}>
        {field.options.map((option) => (
          <label className="pn-check" key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, option.value]
                  : selected.filter((item) => item !== option.value);
                onChange(field.id, next);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "grid") {
    const grid = asGrid(value);
    return (
      <div className="pn-table-wrap">
        <table className="pn-grid">
          <thead>
            <tr>
              <th scope="col">Item</th>
              {field.columns.map((column) => <th key={column.value} scope="col">{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {field.rows.map((row) => (
              <tr key={row.value}>
                <th scope="row">{row.label}</th>
                {field.columns.map((column) => (
                  <td key={column.value}>
                    <label className="pn-check">
                      <input
                        type="radio"
                        name={`${field.id}-${row.value}`}
                        value={column.value}
                        checked={grid[row.value] === column.value}
                        required={required}
                        disabled={disabled}
                        aria-label={`${row.label}: ${column.label}`}
                        onChange={() => onChange(field.id, { ...grid, [row.value]: column.value })}
                      />
                      <span className="pn-sr">{column.label}</span>
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className={field.type === "scale" ? "pn-scale pn-scale-anchors" : "pn-choices"} role="radiogroup" aria-label={field.prompt} aria-describedby={describedBy}>
      {field.options.map((option) => (
        <label className={field.type === "scale" ? "pn-scale-option pn-anchor-option" : "pn-check"} key={option.value}>
          <input
            type="radio"
            name={field.id}
            value={option.value}
            checked={asText(value) === option.value}
            required={required}
            disabled={disabled}
            onChange={() => onChange(field.id, option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
