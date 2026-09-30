import { forwardRef, useEffect, useRef, useState, type FocusEvent } from "react";
import { ChevronDown } from "lucide-react";
import {
  DEFAULT_PHONE_COUNTRY, formatNational, normalizePhone, OTHER_PHONE_COUNTRY, PHONE_COUNTRIES, phoneCountry, phoneCountryByIso, phoneNational,
} from "@rapifix/shared";
import { cn } from "@/lib/cn";

const INTERNATIONAL = /^\s*(\+|00)/;
const digitsOf = (v: string) => v.replace(/\D/g, "");

const PLACEHOLDERS: Record<string, string> = {
  HN: "9999-8888", US: "(305) 555-1234", CA: "(416) 555-1234", DO: "(809) 555-1234", MX: "55 1234 5678",
  GT: "5555-1234", SV: "7777-1234", NI: "8888-1234", CR: "8888-1234", [OTHER_PHONE_COUNTRY]: "+86 138 1234 5678",
};

interface Parsed { iso: string; text: string }

/** Descompone un valor guardado (E.164 o formato hondureño antiguo) en país + número nacional. */
function parse(value: string, currentIso: string): Parsed {
  const v = value.trim();
  if (!v) return { iso: currentIso, text: "" };
  const e164 = normalizePhone(v);
  const c = phoneCountry(e164);
  if (!c) return { iso: OTHER_PHONE_COUNTRY, text: e164 };
  return { iso: c.iso, text: formatNational(c.iso, phoneNational(e164)) };
}

/** Valor que se entrega al formulario: E.164 (o "" si está vacío). */
function emit(iso: string, text: string): string {
  if (!digitsOf(text)) return "";
  if (INTERNATIONAL.test(text) || iso === OTHER_PHONE_COUNTRY) return normalizePhone(INTERNATIONAL.test(text) ? text : `+${digitsOf(text)}`);
  const c = phoneCountryByIso(iso);
  return normalizePhone(text, c?.dial ?? "504");
}

export interface PhoneInputProps {
  /** E.164 (+50499998888), número hondureño antiguo ("9999-8888") o "" */
  value: string | null | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  /** país inicial cuando el campo está vacío (ISO, por defecto Honduras) */
  defaultCountry?: string;
  "aria-label"?: string;
}

/**
 * Campo de teléfono con selector de país. Entrega el número en E.164 (+código + número).
 * Si se pega un número que empieza con "+" o "00" se detecta el país.
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, onBlur, name, id, invalid, disabled, autoFocus, placeholder, className, defaultCountry = DEFAULT_PHONE_COUNTRY, ...rest },
  ref,
) {
  const [state, setState] = useState<Parsed>(() => parse(value ?? "", defaultCountry));
  const lastEmitted = useRef<string>(value ?? "");

  // Si el formulario cambia el valor desde fuera (reset, autocompletar), se vuelve a leer.
  useEffect(() => {
    const v = value ?? "";
    if (v === lastEmitted.current) return;
    lastEmitted.current = v;
    setState((s) => parse(v, v ? s.iso : defaultCountry));
  }, [value, defaultCountry]);

  const update = (next: Parsed) => {
    setState(next);
    const out = emit(next.iso, next.text);
    lastEmitted.current = out;
    onChange(out);
  };

  const onText = (text: string) => {
    if (INTERNATIONAL.test(text)) {
      // número completo con código: detectar el país cuando ya está completo
      const e164 = normalizePhone(text);
      const c = phoneCountry(e164);
      const national = c ? phoneNational(e164) : "";
      if (c && national.length >= c.min) {
        return update({ iso: c.iso, text: formatNational(c.iso, national) });
      }
    }
    update({ iso: state.iso, text });
  };

  const onCountry = (iso: string) => {
    let text = state.text;
    if (iso === OTHER_PHONE_COUNTRY && text && !INTERNATIONAL.test(text)) {
      const current = phoneCountryByIso(state.iso);
      text = current ? `+${current.dial} ${digitsOf(text)}` : text;
    } else if (iso !== OTHER_PHONE_COUNTRY && INTERNATIONAL.test(text)) {
      const e164 = normalizePhone(text);
      const c = phoneCountry(e164);
      if (c) text = phoneNational(e164);
    }
    update({ iso, text });
  };

  const handleBlur = (_e: FocusEvent<HTMLInputElement>) => {
    const { iso, text } = state;
    if (digitsOf(text)) {
      if (INTERNATIONAL.test(text) || iso === OTHER_PHONE_COUNTRY) {
        const e164 = emit(iso, text);
        const c = phoneCountry(e164);
        if (c) setState({ iso: c.iso, text: formatNational(c.iso, phoneNational(e164)) });
        else if (iso !== OTHER_PHONE_COUNTRY) setState({ iso: OTHER_PHONE_COUNTRY, text: e164 });
      } else {
        const c = phoneCountryByIso(iso);
        const national = phoneNational(emit(iso, text));
        if (c && national.length >= c.min && national.length <= c.max) setState({ iso, text: formatNational(iso, national) });
      }
    }
    onBlur?.();
  };

  const country = phoneCountryByIso(state.iso);
  const code = country ? `${country.iso} +${country.dial}` : "Otro";

  return (
    <div
      className={cn(
        "flex h-10 w-full items-stretch overflow-hidden rounded-[10px] border border-slate-200 bg-white text-sm transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100",
        invalid && "border-red-400 focus-within:border-red-400 focus-within:ring-red-100",
        disabled && "bg-slate-50",
        className,
      )}
    >
      {/* el input va primero en el DOM para que la etiqueta del campo lo enfoque */}
      <input
        ref={ref}
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={rest["aria-label"]}
        aria-invalid={invalid || undefined}
        value={state.text}
        placeholder={placeholder ?? PLACEHOLDERS[state.iso] ?? "Número"}
        onChange={(e) => onText(e.target.value)}
        onBlur={handleBlur}
        className="min-w-0 flex-1 bg-transparent px-3 text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:text-slate-500"
      />
      <div className="relative order-first flex shrink-0 items-center gap-1 border-r border-slate-200 bg-slate-50 pl-2.5 pr-2 text-[13px] font-medium text-slate-700">
        <span className="tabular whitespace-nowrap">{code}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        <select
          aria-label="País del número"
          title={country ? `${country.name} (+${country.dial})` : "Otro país"}
          value={state.iso}
          disabled={disabled}
          onChange={(e) => onCountry(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
        >
          {PHONE_COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>{c.name} (+{c.dial})</option>
          ))}
          <option value={OTHER_PHONE_COUNTRY}>Otro (escriba +código)</option>
        </select>
      </div>
    </div>
  );
});
