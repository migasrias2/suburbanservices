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
        <label htmlFor={id} className="mb-2 block text-sm font-normal text-gray-500">
          {label} {required ? <span className="text-red-600">*</span> : null}
        </label>
      )}

      <div
        className={cn(
          "flex items-stretch rounded-xl border bg-white shadow-sm focus-within:ring-1 focus-within:ring-gray-200 transition-all duration-150",
          error ? "border-red-300" : "border-gray-100"
        )}
      >
        {/* UK Flag + Dial Code (fixed) */}
        <div className="h-11 rounded-l-xl rounded-r-none border-r border-gray-50 px-3 py-2 bg-gray-50 flex items-center gap-1.5">
          <span className="text-base leading-none">{UK_FLAG}</span>
          <span className="text-xs font-medium text-gray-600">{UK_DIAL_CODE}</span>
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
              "h-11 border-0 bg-transparent px-4 py-2.5 shadow-none focus-visible:ring-0 rounded-l-none rounded-r-xl",
              "text-sm font-normal placeholder:text-gray-300 placeholder:font-normal"
            )}
          />
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2">
        {helpText && !error ? (
          <p className="text-xs text-gray-500">{helpText}</p>
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