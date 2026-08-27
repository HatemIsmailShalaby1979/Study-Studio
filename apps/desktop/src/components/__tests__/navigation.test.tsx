import { render, screen } from "@testing-library/react";
import NavBar from "@/components/NavBar";
import Breadcrumbs from "@/components/Breadcrumbs";
import { ThemeProvider } from "@/components/ThemeProvider";

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("Navigation", () => {
  it("NavBar exposes Home, Learning Journey, and Generate New on every screen", () => {
    renderWithTheme(<NavBar />);
    const home = screen.getByRole("link", { name: /home/i });
    const journey = screen.getByRole("link", { name: /learning journey/i });
    const generate = screen.getByRole("link", { name: /generate new/i });
    expect(home).toHaveAttribute("href", "/");
    expect(journey).toHaveAttribute("href", "/library");
    expect(generate).toHaveAttribute("href", "/generate");
  });

  it("Breadcrumbs provide a Back affordance plus Home and Library links", () => {
    renderWithTheme(<Breadcrumbs title="Water Cycle Lesson" />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /learning journey/i })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("button", { name: /go back/i })).toBeInTheDocument();
    expect(screen.getByText("Water Cycle Lesson")).toBeInTheDocument();
  });
});
