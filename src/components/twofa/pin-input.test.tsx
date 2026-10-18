// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PinInput } from "./pin-input";

afterEach(() => {
  cleanup();
});

function ControlledPinInput(props: {
  initialValue?: string;
  onComplete?: (val: string) => void;
  disabled?: boolean;
}) {
  const [val, setVal] = useState(props.initialValue ?? "");
  return (
    <PinInput
      value={val}
      onChange={setVal}
      onComplete={props.onComplete}
      disabled={props.disabled}
      label="Nhập mã PIN"
    />
  );
}

describe("PinInput component", () => {
  it("renders 6 dot indicators and accessible hidden input", () => {
    const { container } = render(<ControlledPinInput />);
    const input = screen.getByLabelText("Nhập mã PIN") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.getAttribute("type")).toBe("password");
    expect(input.getAttribute("maxlength")).toBe("6");

    // 6 dots are rendered
    const dotsContainer = container.querySelector('[role="presentation"]');
    expect(dotsContainer).toBeTruthy();
    expect(dotsContainer?.children).toHaveLength(6);
  });

  it("accepts only numeric digits and preserves leading zero", async () => {
    const user = userEvent.setup();
    render(<ControlledPinInput />);
    const input = screen.getByLabelText("Nhập mã PIN") as HTMLInputElement;

    await user.type(input, "0abc12");
    expect(input.value).toBe("012");
  });

  it("automatically calls onComplete when 6th digit is entered", async () => {
    const user = userEvent.setup();
    const handleComplete = vi.fn();
    render(<ControlledPinInput onComplete={handleComplete} />);
    const input = screen.getByLabelText("Nhập mã PIN");

    await user.type(input, "01234");
    expect(handleComplete).not.toHaveBeenCalled();

    await user.type(input, "5");
    expect(handleComplete).toHaveBeenCalledTimes(1);
    expect(handleComplete).toHaveBeenCalledWith("012345");
  });

  it("strictly rejects paste with non-digits or wrong length without partial acceptance", () => {
    const handleComplete = vi.fn();
    render(<ControlledPinInput onComplete={handleComplete} />);
    const input = screen.getByLabelText("Nhập mã PIN") as HTMLInputElement;

    // Paste 5 digits (too short)
    fireEvent.paste(input, {
      clipboardData: { getData: () => "12345" },
    });
    expect(input.value).toBe("");
    expect(handleComplete).not.toHaveBeenCalled();

    // Paste 6 chars with letters
    fireEvent.paste(input, {
      clipboardData: { getData: () => "12345a" },
    });
    expect(input.value).toBe("");
    expect(handleComplete).not.toHaveBeenCalled();
  });

  it("accepts valid 6-digit paste and triggers onComplete", () => {
    const handleComplete = vi.fn();
    render(<ControlledPinInput onComplete={handleComplete} />);
    const input = screen.getByLabelText("Nhập mã PIN") as HTMLInputElement;

    fireEvent.paste(input, {
      clipboardData: { getData: () => "085214" },
    });
    expect(input.value).toBe("085214");
    expect(handleComplete).toHaveBeenCalledTimes(1);
    expect(handleComplete).toHaveBeenCalledWith("085214");
  });

  it("disables input and prevents interaction when disabled is true", async () => {
    const user = userEvent.setup();
    const handleComplete = vi.fn();
    render(<ControlledPinInput disabled={true} onComplete={handleComplete} />);
    const input = screen.getByLabelText("Nhập mã PIN") as HTMLInputElement;

    expect(input.disabled).toBe(true);
    await user.type(input, "123456");
    expect(handleComplete).not.toHaveBeenCalled();
  });

  it("provides screen-reader length announcements without leaking secret digits", () => {
    const { rerender } = render(
      <PinInput value="" onChange={() => {}} label="Nhập mã PIN" />,
    );
    expect(screen.getByText("Chưa nhập chữ số nào")).toBeTruthy();

    rerender(
      <PinInput value="012" onChange={() => {}} label="Nhập mã PIN" />,
    );
    expect(screen.getByText("Đã nhập 3 trên 6 chữ số")).toBeTruthy();
  });
});
