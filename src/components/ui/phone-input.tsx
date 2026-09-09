"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parsePhoneNumberFromString, formatIncompletePhoneNumber } from "libphonenumber-js";

type PhoneInputProps = {
  value: string; // E.164 e.g. "+447700900123"
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  helpText?: string;
  error?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
};

// UK flag emoji
const UK_FLAG = "🇬🇧";
const UK_DIAL_CODE = "+44";

export function PhoneInput({
  value,
  onChange,
  label = "Mobile Number",
  required,
  helpText,
  error,
  className,
  disabled,
  placeholder = "Enter your phone number",
  id,
}: PhoneInputProps) {
  const [national, setNational] = React.useState("");

  // derive initial state from incoming value (E.164)
  React.useEffect(() => {
    if (!value || value === UK_DIAL_CODE) return;
    try {
      const parsed = parsePhoneNumberFromString(value);
      if (parsed?.country === 'GB' && parsed?.nationalNumber) {
        setNational(parsed.nationalNumber);
      }
    } catch (error) {
      console.warn('Error parsing phone number:', error);
    }
  }, [value]);

  function handleNationalChange(next: string) {
    // keep digits only for storage, but format for UI
    let digits = next.replace(/\D/g, "");

    // The dial code is fixed at +44, so a trunk code ("0") or country code
    // ("44") typed into the national field is redundant. Concatenating it
    // anyway is what produced accounts like "+4407586276920" and
    // "+440447591322658" — the same person, two different logins.
    //
    // Only peel once the field is long enough for the prefix to be
    // unambiguous (UK national numbers are 10 digits), so we never eat
    // digits out from under someone who is still typing.
    for (let i = 0; i < 3; i++) {
      if (digits.startsWith("44") && digits.length >= 12) digits = digits.slice(2);
      else if (digits.startsWith("0") && digits.length >= 11) digits = digits.slice(1);
      else break;
    }

    setNational(digits);

    // build E.164 with UK code
    const e164 = digits ? `${UK_DIAL_CODE}${digits}` : UK_DIAL_CODE;
    onChange(e164);
  }

  const formattedNational = React.useMemo(() => {
    // pretty typing UX for UK numbers
    try {
      return formatIncompletePhoneNumber(national, 'GB') || national;
    } catch {
      return national;
    }
  }, [national]);

  const isValid = React.useMemo(() => {
    const p = parsePhoneNumberFromString(value);
    return p?.isValid() ?? false;
  }, [value]);

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label htmlFor={id} className="mb-2 block text-subheadline font-medium text-foreground">
          {label} {required ? <span className="text-destructive">*</span> : null}
        </label>
      )}

      <div
        className={cn(
          "flex items-stretch rounded-2xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring transition-all duration-150",
          error ? "border-destructive" : "border-input"
        )}
      >
        {/* UK Flag + Dial Code (fixed) */}
        <div className="h-11 rounded-l-2xl rounded-r-none border-r border-input px-3 py-2 bg-muted flex items-center gap-1.5">
          <span className="text-base leading-none">{UK_FLAG}</span>
          <span className="text-caption font-semibold text-foreground">{UK_DIAL_CODE}</span>
        </div>

        {/* Number input (national) */}
        <div className="flex-1">
          <Input
            id={id}
            type="tel"
            inputMode="tel"
            disabled={disabled}
            value={formattedNational}
            onChange={(e) => handleNationalChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            className={cn(
              "h-11 border-0 bg-transparent px-4 py-2.5 shadow-none focus-visible:ring-0 rounded-l-none rounded-r-2xl",
              "text-callout font-medium text-foreground placeholder:text-muted-foreground"
            )}
          />
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2">
        {helpText && !error ? (
          <p className="text-caption text-muted-foreground">{helpText}</p>
        ) : null}
        {error ? <p className="text-caption text-destructive">{error}</p> : null}
        {!error && value && value !== UK_DIAL_CODE && (
          <p className={cn("text-caption font-medium", isValid ? "text-success" : "text-warning")}>
            {isValid ? "Valid" : "Check number"}
          </p>
        )}
      </div>
    </div>
  );
}