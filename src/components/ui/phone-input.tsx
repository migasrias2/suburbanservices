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
    const digits = next.replace(/\D/g, "");
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
        <label htmlFor={id} className="mb-2 block text-sm font-medium text-[#0b2f6b]/80">
          {label} {required ? <span className="text-red-500">*</span> : null}
        </label>
      )}

      <div
        className={cn(
          "flex items-stretch rounded-2xl border bg-white/90 shadow-md focus-within:ring-2 focus-within:ring-[#0b2f6b]/30 transition-all duration-150 backdrop-blur",
          error ? "border-red-300" : "border-[#0b2f6b]/20"
        )}
      >
        {/* UK Flag + Dial Code (fixed) */}
        <div className="h-11 rounded-l-2xl rounded-r-none border-r border-[#0b2f6b]/20 px-3 py-2 bg-[#0b2f6b]/10 flex items-center gap-1.5">
          <span className="text-base leading-none">{UK_FLAG}</span>
          <span className="text-xs font-semibold text-[#0b2f6b]/90">{UK_DIAL_CODE}</span>
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
              "text-sm font-medium text-[#0b2f6b] placeholder:text-[#0b2f6b]/40"
            )}
          />
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2">
        {helpText && !error ? (
          <p className="text-xs text-[#0b2f6b]/60">{helpText}</p>
        ) : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {!error && value && value !== UK_DIAL_CODE && (
          <p className={cn("text-xs", isValid ? "text-green-600" : "text-amber-600")}>
            {isValid ? "Valid" : "Check number"}
          </p>
        )}
      </div>
    </div>
  );
}