import { render, screen, act } from "@testing-library/react";
import { StorageWarning } from "@/components/StorageWarning";
import { reportStorageFailure, resetStorageFailureListeners } from "@/lib/storage";

// The warning exists so a failed save is not silent. Its absence was the bug, so
// its presence is worth pinning.

beforeEach(() => {
  resetStorageFailureListeners();
});

describe("StorageWarning", () => {
  it("renders nothing until something fails", () => {
    render(<StorageWarning />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a quota failure with actionable advice", () => {
    render(<StorageWarning />);

    act(() => {
      reportStorageFailure({
        key: "study-studio",
        reason: "quota",
        message: "Your device storage is full, so this change was NOT saved.",
      });
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/storage is full/i);
    // The message must make clear the change did not save.
    expect(alert).toHaveTextContent(/NOT saved/i);
    // And offer a next step.
    expect(alert).toHaveTextContent(/deleting a lesson/i);
  });

  it("shows a non-quota failure without the quota-specific advice", () => {
    render(<StorageWarning />);

    act(() => {
      reportStorageFailure({
        key: "study-studio",
        reason: "corrupt",
        message: "Saved data was unreadable.",
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/unreadable/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/deleting a lesson/i);
  });

  it("stays until dismissed rather than disappearing on a timer", () => {
    render(<StorageWarning />);

    act(() => {
      reportStorageFailure({ key: "k", reason: "quota", message: "full" });
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => {
      screen.getByLabelText(/dismiss storage warning/i).click();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not replace an existing warning with a later one", () => {
    render(<StorageWarning />);

    act(() => {
      reportStorageFailure({ key: "k", reason: "quota", message: "first failure" });
    });
    act(() => {
      reportStorageFailure({ key: "k", reason: "corrupt", message: "second failure" });
    });

    // The first is the one the user needs to act on; swapping it out mid-read
    // would be worse than ignoring the second.
    expect(screen.getByRole("alert")).toHaveTextContent("first failure");
  });
});
