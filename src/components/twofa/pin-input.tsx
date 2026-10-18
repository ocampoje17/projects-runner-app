import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: boolean;
  id?: string;
  label?: string;
  className?: string;
}

export function PinInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
  error = false,
  id = "twofa-pin-input",
  label = "Mã PIN 6 số",
  className,
}: PinInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const submittedValueRef = useRef<string | null>(null);

  useEffect(() => {
    if (autoFocus && !disabled) {
      inputRef.current?.focus();
    }
  }, [autoFocus, disabled]);

  // When value is cleared or changed externally, reset submission guard
  useEffect(() => {
    if (value.length < 6) {
      submittedValueRef.current = null;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const raw = e.target.value;
    // Only accept ASCII digits 0-9
    const digitsOnly = raw.replace(/\D/g, "").slice(0, 6);
    onChange(digitsOnly);

    if (digitsOnly.length === 6 && submittedValueRef.current !== digitsOnly) {
      submittedValueRef.current = digitsOnly;
      onComplete?.(digitsOnly);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (disabled) return;
    const pasted = e.clipboardData.getData("text").trim();
    // Strictly require exactly 6 ASCII digits. Reject partial or invalid content.
    if (/^[0-9]{6}$/.test(pasted)) {
      onChange(pasted);
      if (submittedValueRef.current !== pasted) {
        submittedValueRef.current = pasted;
        onComplete?.(pasted);
      }
    }
  };

  const handleContainerClick = () => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className={cn("flex flex-col items-center gap-2", className)}
      onClick={handleContainerClick}
    >
      {/* Hidden input for receiving focus, keyboard, and paste events */}
      <input
        ref={inputRef}
        id={id}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error}
        className="sr-only"
      />

      {/* 6-dot indicator representation */}
      <div
        className={cn(
          "flex items-center justify-center gap-3.5 rounded-lg border border-transparent p-2.5 transition-all cursor-pointer",
          isFocused && "border-[var(--vscode-focusBorder,#007fd4)] ring-1 ring-[var(--vscode-focusBorder,#007fd4)]",
          error && "border-red-500 ring-1 ring-red-500",
          disabled && "opacity-60 cursor-not-allowed",
        )}
        role="presentation"
      >
        {Array.from({ length: 6 }).map((_, index) => {
          const isFilled = index < value.length;
          const isCurrent = isFocused && index === value.length;

          return (
            <div
              key={index}
              className={cn(
                "h-4 w-4 rounded-full border transition-all duration-150",
                isFilled
                  ? error
                    ? "border-red-500 bg-red-500"
                    : "border-[var(--vscode-button-bg,#0e639c)] bg-[var(--vscode-button-bg,#0e639c)] scale-110"
                  : "border-[var(--vscode-border,#454545)] bg-[var(--vscode-input-bg,rgba(255,255,255,0.05))]",
                isCurrent && "ring-2 ring-[var(--vscode-focusBorder,#007fd4)] ring-offset-2 ring-offset-[var(--vscode-editor-bg,#1e1e1e)]",
              )}
            />
          );
        })}
      </div>

      {/* Screen-reader live region announcing length without leaking secret PIN digits */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {value.length === 0
          ? "Chưa nhập chữ số nào"
          : `Đã nhập ${value.length} trên 6 chữ số`}
      </div>
    </div>
  );
}
