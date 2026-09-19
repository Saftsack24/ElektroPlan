import type { ReactNode } from "react";

/**
 * Gemeinsame Formularbausteine der Oberflaeche.
 *
 * Sie liegen im Core, weil mehrere Module sie brauchen. Eine Seite exportiert
 * keine Bausteine fuer andere Seiten - das haette die lazy geladenen Chunks
 * aneinandergekettet und die Zustaendigkeit verwischt (docs/modules.md,
 * Abschnitt 8).
 */

/** Ein beschriftetes Textfeld mit optionaler Fehlermeldung. */
export function Feld({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  fehler,
  hinweis,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  fehler?: string | undefined;
  hinweis?: string | undefined;
  disabled?: boolean;
}) {
  const fehlerId = `${id}-fehler`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={id}
        className={fehler ? "field__input field__input--fehler" : "field__input"}
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={fehler ? fehlerId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {fehler !== undefined && (
        <span id={fehlerId} className="field__fehler" role="alert">
          {fehler}
        </span>
      )}
      {hinweis !== undefined && <span className="field__hinweis">{hinweis}</span>}
    </div>
  );
}

/** Ein beschriftetes Auswahlfeld. */
export function Auswahl({
  id,
  label,
  value,
  onChange,
  required = false,
  fehler,
  disabled = false,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  fehler?: string | undefined;
  disabled?: boolean;
  children: ReactNode;
}) {
  const fehlerId = `${id}-fehler`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      <select
        id={id}
        className={fehler ? "field__input field__input--fehler" : "field__input"}
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={fehler ? fehlerId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      {fehler !== undefined && (
        <span id={fehlerId} className="field__fehler" role="alert">
          {fehler}
        </span>
      )}
    </div>
  );
}

/** Ein beschriftetes Kontrollkaestchen. */
export function Schalter({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field field--schalter">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
